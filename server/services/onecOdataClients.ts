/**
 * Клиенты 1С по OData (docs/onec-odata.md, «Клиенты и соглашения»): партнёры с `Клиент = true`,
 * их контрагенты (УНП), соглашения, договоры, зоны доставки, сегменты запрета отгрузки и адреса —
 * в форме `Client` контракта.
 *
 * Сопоставление — чистая `mapClients`, чтение — `readClientSources`. Чего OData пока не даёт
 * (e-mail менеджера, отсрочка, долг), заполняется запасным значением; сколько клиентов без
 * соглашения, УНП, зоны и адреса — считает `ClientStats`, стенд это показывает.
 */
import { createHash } from 'node:crypto'
import { Client, type ClientT, type ContractT, type DeliveryAddress } from '../../shared/onec/schemas'
import type { z } from 'zod'
import { OnecError } from './onec'
import { assertGuid, EMPTY_REF, ODATA_MAX_PAGES, ODATA_PAGE, type ODataClient } from './onecOdata'

export interface PartnerRow {
  Ref_Key: string
  Description?: string
  DeletionMark?: boolean
  Клиент?: boolean
  ЗонаДоставки_Key?: string
}

export interface CounterpartyRow { Ref_Key: string, Партнер_Key?: string, ИНН?: string, DeletionMark?: boolean }

export interface AgreementRow {
  Ref_Key: string
  Description?: string
  DeletionMark?: boolean
  Партнер_Key?: string
  Статус?: string
  Номер?: string
  Дата?: string
  ДатаНачалаДействия?: string
  ДатаОкончанияДействия?: string
  ВидЦен_Key?: string
  Валюта_Key?: string
  Договор_Key?: string
}

export interface ContractRow { Ref_Key: string, Номер?: string, Дата?: string, ДопустимаяСуммаЗадолженности?: number }

export interface ContactRow { Ref_Key: string, LineNumber?: string | number, Тип?: string, Вид_Key?: string, Представление?: string, Город?: string }

export interface ClientSources {
  partners: PartnerRow[]
  counterparties: CounterpartyRow[]
  agreements: AgreementRow[]
  contracts: ContractRow[]
  contacts: ContactRow[]
  zones: Map<string, string>
  currencies: Map<string, string>
  /** Партнёры в сегментах с запретом отгрузки. */
  blocked: Set<string>
}

export interface ClientStats {
  clients: number
  /** Без действующего соглашения: цен клиенту не покажем. */
  noAgreement: number
  /** Несколько действующих соглашений: взято самое позднее по дате (выбор в корзине — #46). */
  manyAgreements: number
  noPriceType: number
  noCurrency: number
  noUnp: number
  noZone: number
  noAddress: number
  blocked: number
}

export const emptyClientStats = (): ClientStats => ({ clients: 0, noAgreement: 0, manyAgreements: 0, noPriceType: 0, noCurrency: 0, noUnp: 0, noZone: 0, noAddress: 0, blocked: 0 })

/** Статус соглашения, при котором по нему продают (перечисление 1С приходит строкой). */
export const ACTIVE_AGREEMENT = 'Действует'

const ref = (v: string | undefined) => (v && v !== EMPTY_REF ? v.toLowerCase() : null)
const day = (v: string | undefined) => (v && !v.startsWith('0001') ? v.slice(0, 10) : '')
const money = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : 0)

/** Действует ли соглашение на `today` (ГГГГ-ММ-ДД): статус, пометка удаления, даты действия. */
export function agreementActive(a: AgreementRow, today: string): boolean {
  if (a.DeletionMark || (a.Статус ?? '').trim() !== ACTIVE_AGREEMENT) return false
  const from = day(a.ДатаНачалаДействия)
  const to = day(a.ДатаОкончанияДействия)
  return (!from || from <= today) && (!to || to >= today)
}

/**
 * GUID адреса доставки: у строки контактной информации своего GUID нет, а заявка ссылается на адрес.
 * Детерминирован от партнёра, вида и текста адреса — переставленные строки не меняют ссылку.
 */
export function addressGuid(partner: string, kind: string, text: string): string {
  const h = createHash('sha1').update(`${partner}|${kind}|${text}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** Версия клиента — всё, что видит ЛК: изменилось хоть что-то из связанных объектов — клиент изменён. */
export function clientVersion(c: ClientT): string {
  return createHash('sha1').update(JSON.stringify({ ...c, changedAt: '' })).digest('hex')
}

/** Клиенты контракта из прочитанных объектов 1С. `today` — ГГГГ-ММ-ДД по Минску. */
export function mapClients(src: ClientSources, today: string, stats = emptyClientStats()): Array<{ client: ClientT, version: string }> {
  const byPartner = <T extends { Партнер_Key?: string }>(rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) {
      const p = ref(r.Партнер_Key)
      if (p) m.set(p, [...(m.get(p) ?? []), r])
    }
    return m
  }
  const counterparties = byPartner(src.counterparties.filter(c => !c.DeletionMark))
  const agreements = byPartner(src.agreements.filter(a => agreementActive(a, today)))
  const contracts = new Map(src.contracts.map(c => [c.Ref_Key.toLowerCase(), c]))
  const contacts = new Map<string, ContactRow[]>()
  for (const c of src.contacts) {
    if ((c.Тип ?? '').trim() !== 'Адрес' || !(c.Представление ?? '').trim()) continue
    const p = c.Ref_Key.toLowerCase()
    contacts.set(p, [...(contacts.get(p) ?? []), c])
  }

  const out: Array<{ client: ClientT, version: string }> = []
  for (const p of src.partners) {
    if (p.Клиент === false) continue
    const guid = p.Ref_Key.toLowerCase()
    stats.clients++
    const unp = (counterparties.get(guid) ?? []).map(c => (c.ИНН ?? '').trim()).find(Boolean) ?? ''
    if (!unp) stats.noUnp++
    const zone = ref(p.ЗонаДоставки_Key)
    const zoneName = zone ? src.zones.get(zone) : undefined
    if (!zoneName) stats.noZone++
    const blocked = src.blocked.has(guid)
    if (blocked) stats.blocked++
    const addresses = (contacts.get(guid) ?? []).map((c) => {
      const text = (c.Представление ?? '').trim()
      return { guid: addressGuid(guid, ref(c.Вид_Key) ?? '', `${(c.Город ?? '').trim()}|${text}`), city: (c.Город ?? '').trim(), address: text } satisfies z.infer<typeof DeliveryAddress>
    })
    if (!addresses.length) stats.noAddress++
    const unique = [...new Map(addresses.map(x => [x.guid, x])).values()]
    const client: ClientT = {
      guid,
      name: (p.Description ?? '').trim(),
      unp,
      address: unique[0]?.address ?? '',
      city: unique[0]?.city ?? '',
      region: zone && zoneName ? { guid: zone, name: zoneName } : null,
      shipmentBlocked: blocked,
      // E-mail менеджера — в контактной информации пользователя, справочник ещё не читаем.
      managerEmail: '',
      contract: pickContract(agreements.get(guid) ?? [], contracts, src.currencies, stats),
      // Пока все адреса партнёра: какой вид — «адрес доставки», покажет стенд (ответ 1С 2026-10-20).
      deliveryAddresses: unique,
      changedAt: '',
      deleted: p.DeletionMark === true,
    }
    out.push({ client, version: clientVersion(client) })
  }
  return out
}

/**
 * Соглашение клиента в форме `Contract`: из действующих — только с видом цен и известной валютой
 * (иначе цены клиента ушли бы не в той валюте); из них — самое позднее по началу действия, затем
 * по дате, затем по ссылке. Подходящих нет — договора нет, цен клиент не видит.
 */
function pickContract(active: AgreementRow[], contracts: Map<string, ContractRow>, currencies: Map<string, string>, stats: ClientStats): ContractT | null {
  if (!active.length) {
    stats.noAgreement++
    return null
  }
  if (active.length > 1) stats.manyAgreements++
  const withPrice = active.filter(a => ref(a.ВидЦен_Key))
  if (!withPrice.length) {
    stats.noPriceType++
    return null
  }
  const usable = withPrice.filter(a => ref(a.Валюта_Key) && currencies.has(ref(a.Валюта_Key)!))
  if (!usable.length) {
    stats.noCurrency++
    return null
  }
  const when = (a: AgreementRow) => `${day(a.ДатаНачалаДействия)}|${day(a.Дата)}`
  const a = [...usable].sort((x, y) => when(y).localeCompare(when(x)) || x.Ref_Key.toLowerCase().localeCompare(y.Ref_Key.toLowerCase()))[0]!
  const contract = ref(a.Договор_Key) ? contracts.get(ref(a.Договор_Key)!) : undefined
  return {
    guid: a.Ref_Key.toLowerCase(),
    number: ((a.Номер || contract?.Номер) ?? '').trim(),
    // Дата обязательна в контракте; пустые у 1С — «0001-01-01», тогда начало действия или договор.
    date: day(a.Дата) || day(a.ДатаНачалаДействия) || day(contract?.Дата) || '2000-01-01',
    priceTypeGuid: ref(a.ВидЦен_Key)!,
    // Отсрочка — в табличной части «Этапы графика оплаты», её пока не читаем (docs/onec-odata.md).
    paymentDelayDays: 0,
    creditLimit: money(contract?.ДопустимаяСуммаЗадолженности),
    // Долг — в регистре расчётов, он ещё не опубликован.
    debt: 0,
    currency: currencies.get(ref(a.Валюта_Key)!)!,
  }
}

/** Все строки набора страницами по `ODATA_PAGE` (упорядочено по `orderby`, чтобы `$skip` был устойчив). */
export async function listAll<T>(client: ODataClient, set: string, query: Record<string, string>, orderby = 'Ref_Key', maxPages = ODATA_MAX_PAGES): Promise<T[]> {
  const out: T[] = []
  for (let page = 0; page < maxPages; page++) {
    const rows = await client.list<T>(set, { ...query, $orderby: orderby, $top: ODATA_PAGE, $skip: page * ODATA_PAGE })
    out.push(...rows)
    if (rows.length < ODATA_PAGE) return out
  }
  throw new OnecError('contract', `1C OData ${set}: more than ${maxPages} pages`)
}

/**
 * Прочитать всё для клиентов. Обязательно всё: не прочиталось — прогон падает. Иначе пустой набор
 * соглашений, адресов, зон или сегментов затёр бы договоры, адреса, регионы и запрет отгрузки у
 * всех клиентов в ЛК разом (ревью PR #63).
 */
export async function readClientSources(client: ODataClient): Promise<ClientSources> {
  const partners = await listAll<PartnerRow>(client, 'Catalog_Партнеры', {
    $select: 'Ref_Key,Description,DeletionMark,Клиент,ЗонаДоставки_Key',
    $filter: 'Клиент eq true',
  })
  const counterparties = await listAll<CounterpartyRow>(client, 'Catalog_Контрагенты', { $select: 'Ref_Key,Партнер_Key,ИНН,DeletionMark' })
  const agreements = await listAll<AgreementRow>(client, 'Catalog_СоглашенияСКлиентами', {
    $select: 'Ref_Key,Description,DeletionMark,Партнер_Key,Статус,Номер,Дата,ДатаНачалаДействия,ДатаОкончанияДействия,ВидЦен_Key,Валюта_Key,Договор_Key',
  })
  const contracts = await listAll<ContractRow>(client, 'Catalog_ДоговорыКонтрагентов', { $select: 'Ref_Key,Номер,Дата,ДопустимаяСуммаЗадолженности' })
  const contacts = await listAll<ContactRow>(client, 'Catalog_Партнеры_КонтактнаяИнформация', {
    $select: 'Ref_Key,LineNumber,Тип,Вид_Key,Представление,Город',
  }, 'Ref_Key,LineNumber')
  const zones = await client.names('Catalog_ЗоныДоставки')
  if (zones.error) throw new OnecError('contract', `1C OData Catalog_ЗоныДоставки: ${zones.error}`)
  const currencies = await client.currencies()
  if (currencies.error) throw new OnecError('contract', `1C OData Catalog_Валюты: ${currencies.error}`)
  const segments = await client.list<{ Ref_Key: string, ЗапретОтгрузки?: boolean, DeletionMark?: boolean }>('Catalog_СегментыПартнеров', { $select: 'Ref_Key,ЗапретОтгрузки,DeletionMark' })
  const stop = new Set(segments.filter(s => s.ЗапретОтгрузки && !s.DeletionMark).map(s => s.Ref_Key.toLowerCase()))
  let blocked = new Set<string>()
  if (stop.size) {
    const members = await listAll<{ Ref_Key: string, Партнер_Key?: string }>(client, 'Catalog_СегментыПартнеров_ПартнерыПоСегменту', { $select: 'Ref_Key,Партнер_Key' }, 'Ref_Key,LineNumber')
    blocked = new Set(members.filter(m => stop.has(m.Ref_Key.toLowerCase())).flatMap(m => (ref(m.Партнер_Key) ? [ref(m.Партнер_Key)!] : [])))
  }
  // Пустой набор соглашений при живых партнёрах — сбой чтения, а не «у всех истекло»: иначе все
  // клиенты разом ушли бы удалёнными.
  if (partners.length && !agreements.length) throw new OnecError('contract', '1C OData Catalog_СоглашенияСКлиентами: no rows')
  return { partners, counterparties, agreements, contracts, contacts, zones: zones.map, currencies: currencies.map, blocked }
}

/**
 * Всё для ОДНОГО клиента по GUID партнёра — несколько точечных запросов вместо чтения всех
 * партнёров (решение владельца 2026-10-22: ЛК грузит данные клиента при входе и по расписанию).
 * Нет партнёра или он не клиент — `null`.
 */
export async function readClientSourcesFor(client: ODataClient, partnerGuid: string): Promise<ClientSources | null> {
  const g = `guid'${assertGuid(partnerGuid)}'`
  const partners = await client.list<PartnerRow>('Catalog_Партнеры', { $select: 'Ref_Key,Description,DeletionMark,Клиент,ЗонаДоставки_Key', $filter: `Ref_Key eq ${g}` })
  if (!partners.length || partners[0]!.Клиент === false) return null
  const byPartner = { $filter: `Партнер_Key eq ${g}` }
  const counterparties = await client.list<CounterpartyRow>('Catalog_Контрагенты', { $select: 'Ref_Key,Партнер_Key,ИНН,DeletionMark', ...byPartner })
  const agreements = await client.list<AgreementRow>('Catalog_СоглашенияСКлиентами', {
    $select: 'Ref_Key,Description,DeletionMark,Партнер_Key,Статус,Номер,Дата,ДатаНачалаДействия,ДатаОкончанияДействия,ВидЦен_Key,Валюта_Key,Договор_Key', ...byPartner,
  })
  const contractKeys = [...new Set(agreements.flatMap(a => (ref(a.Договор_Key) ? [ref(a.Договор_Key)!] : [])))].slice(0, 40) // у клиента их единицы (стенд: максимум 31 соглашение)
  const contracts = contractKeys.length
    ? await client.list<ContractRow>('Catalog_ДоговорыКонтрагентов', { $select: 'Ref_Key,Номер,Дата,ДопустимаяСуммаЗадолженности', $filter: contractKeys.map(k => `Ref_Key eq guid'${assertGuid(k)}'`).join(' or ') })
    : []
  const contacts = await client.list<ContactRow>('Catalog_Партнеры_КонтактнаяИнформация', { $select: 'Ref_Key,LineNumber,Тип,Вид_Key,Представление,Город', $filter: `Ref_Key eq ${g}` })
  const zones = await client.names('Catalog_ЗоныДоставки')
  if (zones.error) throw new OnecError('contract', `1C OData Catalog_ЗоныДоставки: ${zones.error}`)
  const currencies = await client.currencies()
  if (currencies.error) throw new OnecError('contract', `1C OData Catalog_Валюты: ${currencies.error}`)
  const members = await client.list<{ Ref_Key: string, Партнер_Key?: string }>('Catalog_СегментыПартнеров_ПартнерыПоСегменту', { $select: 'Ref_Key,Партнер_Key', ...byPartner })
  let blocked = new Set<string>()
  if (members.length) {
    const segments = await client.list<{ Ref_Key: string, ЗапретОтгрузки?: boolean, DeletionMark?: boolean }>('Catalog_СегментыПартнеров', { $select: 'Ref_Key,ЗапретОтгрузки,DeletionMark', $filter: 'ЗапретОтгрузки eq true' })
    const stop = new Set(segments.filter(s => s.ЗапретОтгрузки && !s.DeletionMark).map(s => s.Ref_Key.toLowerCase()))
    if (members.some(m => stop.has(m.Ref_Key.toLowerCase()))) blocked = new Set([partnerGuid.toLowerCase()])
  }
  return { partners, counterparties, agreements, contracts, contacts, zones: zones.map, currencies: currencies.map, blocked }
}

/** Проверка схемой контракта: «прошло здесь» значит «ЛК прочитает». */
export function checkedClients<T extends { client: ClientT }>(rows: T[]): T[] {
  for (const [i, r] of rows.entries()) {
    const parsed = Client.safeParse({ ...r.client, changedAt: r.client.changedAt || '2000-01-01T00:00:00+03:00' })
    if (!parsed.success) throw new OnecError('contract', `1C OData clients: row ${i} breaks contract at ${parsed.error.issues.slice(0, 3).map(x => x.path.join('.')).join(', ')}`)
  }
  return rows
}
