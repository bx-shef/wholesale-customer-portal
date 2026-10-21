/**
 * Разведка OData 1С (docs/onec-odata.md): какие объекты нужны ЛК, опубликованы ли они и из каких
 * полей состоят. Читает только `$metadata` и по одной строке ключа каждого набора, чтобы проверить
 * права на чтение. Значений полей в отчёт не кладём: в публикации лежат и персональные данные.
 *
 * Чистое ядро: `fetch` внедряется, тесты гоняют его на фикстуре.
 */
import { onecAuthHeader, type OnecAuth } from '../services/onec'
import { DEFAULT_STOCK_WAREHOUSES, ODataClient } from '../services/onecOdata'
import { agreementActive, emptyClientStats, mapClients, readClientSources } from '../services/onecOdataClients'
import { minskDay } from '../services/onecOdataSource'

/** Объекты 1С, из которых ЛК собирает свой контракт, и зачем каждый нужен. */
export const ODATA_SETS: ReadonlyArray<{ name: string, why: string }> = [
  { name: 'Catalog_Номенклатура', why: 'каталог' },
  { name: 'Catalog_ВидыНоменклатуры', why: 'группы каталога' },
  { name: 'Catalog_НоменклатураПрисоединенныеФайлы', why: 'картинки товаров' },
  { name: 'InformationRegister_ЦеныНоменклатуры25', why: 'цены (новое ценообразование)' },
  { name: 'InformationRegister_ЦеныНоменклатуры', why: 'цены (прежний регистр)' },
  { name: 'Catalog_ВидыЦен', why: 'виды цен' },
  { name: 'AccumulationRegister_ТоварыНаСкладах', why: 'остатки' },
  { name: 'Catalog_Склады', why: 'склады' },
  { name: 'Catalog_Партнеры', why: 'клиенты' },
  { name: 'Catalog_Контрагенты', why: 'юрлица клиентов' },
  { name: 'Catalog_СоглашенияСКлиентами', why: 'соглашения: вид цен и оплата (#46)' },
  { name: 'Catalog_ДоговорыКонтрагентов', why: 'договоры' },
  { name: 'Catalog_СегментыПартнеров', why: 'сегмент запрета отгрузки' },
  { name: 'Catalog_ЗоныДоставки', why: 'зона доставки клиента (#46)' },
  { name: 'Catalog_БизнесРегионы', why: 'бизнес-регионы' },
  { name: 'Document_ЗаказКлиента', why: 'заказы: запись и статусы' },
  { name: 'Document_ЗаданиеНаПеревозку', why: 'рейсы' },
  // Второй круг (разведка 2026-10-20): на них ссылаются поля первых шестнадцати.
  { name: 'Catalog_УпаковкиЕдиницыИзмерения', why: 'единица и кратность товара' },
  { name: 'Catalog_Марки', why: 'бренд товара' },
  { name: 'Catalog_Валюты', why: 'код валюты цены и соглашения' },
  { name: 'Catalog_СтавкиНДС', why: 'ставка НДС товара' },
  { name: 'Catalog_Организации', why: 'организация в заказе' },
  { name: 'Catalog_Пользователи', why: 'менеджер клиента' },
  { name: 'ChartOfCharacteristicTypes_ДополнительныеРеквизитыИСведения', why: 'имена свойств товара' },
  { name: 'AccumulationRegister_РасчетыСКлиентами', why: 'долг клиента' },
  { name: 'InformationRegister_АналитикаУчетаПоПартнерам', why: 'долг: аналитика расчётов → партнёр и договор' },
  { name: 'Document_РеализацияТоваровУслуг', why: 'отгрузка заказа (статус «отгружен»)' },
]

export interface ODataType {
  name: string
  properties: Array<{ name: string, type: string }>
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? ''

/** Типы из `$metadata`: EntityType и ComplexType (табличные части 1С описаны как ComplexType). */
export function parseMetadata(xml: string): Map<string, ODataType> {
  const types = new Map<string, ODataType>()
  const re = /<(EntityType|ComplexType)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g
  for (const m of xml.matchAll(re)) {
    const name = attr(m[2]!, 'Name')
    if (!name) continue
    const properties = [...(m[4] ?? '').matchAll(/<(?:Property|NavigationProperty)\b([^>]*)>/g)]
      .map(p => ({ name: attr(p[1]!, 'Name'), type: attr(p[1]!, 'Type') }))
      .filter(p => p.name)
    types.set(name, { name, properties })
  }
  return types
}

/** Набор и его табличные части: `Document_ЗаказКлиента` и `Document_ЗаказКлиента_Товары…`. */
export function typesOf(set: string, types: Map<string, ODataType>): ODataType[] {
  return [...types.values()]
    .filter(t => t.name === set || t.name.startsWith(`${set}_`))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface ODataCheck {
  id: string
  title: string
  status: 'ok' | 'fail' | 'skip'
  detail: string
  /** Поля типа и его табличных частей — только имена и типы. */
  fields?: ODataType[]
  ms: number
}

export interface ODataProbeInput {
  /** Адрес публикации OData: `https://…/<база>/odata/standard.odata`. */
  baseUrl: string
  auth: OnecAuth
  fetch: typeof fetch
  timeoutMs?: number
  /** Склады для остатков (только для цен и остатков). */
  stockWarehouses?: string[]
  /** Журнал запросов к 1С — стенд показывает его, пока идёт прогон. */
  onRequest?: (e: { label: string, ms: number, rows?: number, error?: string }) => void
}

export async function runODataProbe(input: ODataProbeInput, now: () => number = Date.now): Promise<ODataCheck[]> {
  const base = input.baseUrl.replace(/\/+$/, '')
  const headers = { authorization: onecAuthHeader(input.auth) }
  const get = (path: string, accept: string) =>
    input.fetch(base + path, { headers: { ...headers, accept }, signal: AbortSignal.timeout(input.timeoutMs ?? 60_000) })
  const checks: ODataCheck[] = []

  let started = now()
  let types: Map<string, ODataType>
  try {
    const res = await get('/$metadata', 'application/xml')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    types = parseMetadata(await res.text())
    checks.push({ id: 'metadata', title: 'Описание публикации ($metadata)', status: 'ok', detail: `типов: ${types.size}`, ms: now() - started })
  }
  catch (e) {
    checks.push({ id: 'metadata', title: 'Описание публикации ($metadata)', status: 'fail', detail: reason(e), ms: now() - started })
    return checks
  }

  for (const set of ODATA_SETS) {
    const title = `${set.name} — ${set.why}`
    const fields = typesOf(set.name, types)
    if (!fields.length) {
      checks.push({ id: set.name, title, status: 'fail', detail: 'не опубликован', ms: 0 })
      continue
    }
    started = now()
    try {
      // Права на чтение: одна строка, без полей — значения в отчёт не попадают.
      const res = await get(`/${encodeURIComponent(set.name)}?$top=1&$select=${keyOf(fields[0]!)}&$format=json`, 'application/json')
      checks.push(res.ok
        ? { id: set.name, title, status: 'ok', detail: 'читается', fields, ms: now() - started }
        : { id: set.name, title, status: 'fail', detail: `опубликован, чтение — HTTP ${res.status}`, fields, ms: now() - started })
    }
    catch (e) {
      checks.push({ id: set.name, title, status: 'fail', detail: reason(e), fields, ms: now() - started })
    }
  }
  return checks
}

/** Ключ набора: у справочников и документов `Ref_Key`, у регистров — первое поле. */
function keyOf(t: ODataType): string {
  return t.properties.some(p => p.name === 'Ref_Key') ? 'Ref_Key' : (t.properties[0]?.name ?? 'Ref_Key')
}

function reason(e: unknown): string {
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'нет ответа за 60 с'
  return e instanceof Error ? e.message : String(e)
}

/** Плоский текст полей для пересылки разработчику: имена и типы, без значений. */
export function fieldsText(checks: ODataCheck[]): string {
  return checks
    .flatMap(c => [`# ${c.title}: ${c.detail}`, ...(c.fields ?? []).flatMap(t => [`## ${t.name}`, ...t.properties.map(p => `${p.name}: ${p.type}`)])])
    .join('\n')
}

/**
 * Каталог через клиент OData — тот, которым будет ходить ЛК: справочники, первая страница,
 * проверка схемой контракта и образец товаров. Товары — не персональные данные, их показываем.
 */
export async function runODataCatalogProbe(input: ODataProbeInput, now: () => number = Date.now): Promise<ODataCheck[]> {
  const client = new ODataClient({ baseUrl: input.baseUrl, auth: input.auth, fetch: input.fetch, timeoutMs: input.timeoutMs })
  const checks: ODataCheck[] = []
  let started = now()
  const look = await client.catalogLookups()
  checks.push({
    id: 'lookups',
    title: 'Справочники каталога: единицы и марки',
    status: look.missing.length ? 'skip' : 'ok',
    detail: `единиц: ${look.units.size}, марок: ${look.brands.size}${look.missing.length ? `; не читаются: ${look.missing.join(', ')} — будут «шт» и пустой бренд` : ''}`,
    ms: now() - started,
  })
  started = now()
  try {
    const page = await client.catalog({ page: 1, pageSize: 50 }, look)
    const withSection = page.items.filter(i => i.sectionGuid !== page.sections[0]?.guid).length
    const sample = page.items.slice(0, 10).map(i => `${i.sku || '—'} · ${i.name} · ${i.unit}${i.brand ? ` · ${i.brand}` : ''}${i.images.length ? ' · есть картинка' : ''}${i.deleted ? ' · помечен на удаление' : ''}`)
    checks.push({
      id: 'catalog',
      title: 'Каталог по контракту (первые 50 товаров)',
      status: page.items.length ? 'ok' : 'fail',
      detail: `разделов: ${page.sections.length}, товаров: ${page.items.length}, в группах: ${withSection}, с артикулом: ${page.items.filter(i => i.sku).length}, с картинкой: ${page.items.filter(i => i.images.length).length}, дальше есть: ${page.nextPage ? 'да' : 'нет'}`,
      fields: [{ name: 'Образец', properties: sample.map(name => ({ name, type: '' })) }],
      ms: now() - started,
    })
  }
  catch (e) {
    checks.push({ id: 'catalog', title: 'Каталог по контракту (первые 50 товаров)', status: 'fail', detail: reason(e), ms: now() - started })
  }
  return checks
}

/**
 * Цены и остатки через клиент OData: способ чтения прайса, счётчики, образцы.
 * Цены и остатки — не персональные данные; названия товаров берём из каталога для образца.
 */
export async function runODataPricesProbe(input: ODataProbeInput, now: () => number = Date.now): Promise<ODataCheck[]> {
  const client = new ODataClient({ baseUrl: input.baseUrl, auth: input.auth, fetch: input.fetch, timeoutMs: input.timeoutMs ?? 120_000, onRequest: input.onRequest, stockWarehouses: input.stockWarehouses ?? DEFAULT_STOCK_WAREHOUSES })
  const checks: ODataCheck[] = []
  const priceTypes = (await client.names('Catalog_ВидыЦен')).map
  // Названия — только для образца (10 товаров): весь справочник ради них не читаем.
  const names = new Map<string, string>()
  const loadNames = async (guids: string[]) => {
    const need = [...new Set(guids)].filter(g => !names.has(g)).slice(0, 20)
    if (!need.length) return
    const rows = await client.list<{ Ref_Key: string, Description?: string }>('Catalog_Номенклатура', {
      $select: 'Ref_Key,Description',
      $filter: need.map(g => `Ref_Key eq guid'${g}'`).join(' or '),
    }).catch(() => [])
    for (const r of rows) names.set(r.Ref_Key.toLowerCase(), r.Description ?? '')
  }
  const name = (g: string) => names.get(g) || g

  let started = now()
  try {
    // Стенду хватит образца: не больше 1000 цен, НДС — только для них.
    const p = await client.prices({ limit: 1000 })
    await loadNames(p.items.slice(0, 10).map(i => i.itemGuid))
    const byType = new Map<string, number>()
    for (const i of p.items) byType.set(i.priceTypeGuid, (byType.get(i.priceTypeGuid) ?? 0) + 1)
    const currencies = [...new Set(p.items.map(i => i.currency))].join(', ')
    checks.push({
      id: 'prices',
      title: 'Прайс по видам цен',
      status: p.items.length ? 'ok' : 'fail',
      detail: `строк: ${p.items.length}, видов цен: ${byType.size}, валюты: ${currencies || '—'}, с НДС: ${p.items.filter(i => i.vatRate > 0).length}; чтение: ${p.register.replace('InformationRegister_', '')}, ${p.via === 'slice' ? 'срез последних' : 'наборы записей регистра (медленнее)'}`
        + `; прочитано записей: ${p.stats.read}, отброшено: неактивных ${p.stats.inactive}, характеристик и упаковок ${p.stats.variant}, без ссылок ${p.stats.noRef}, без валюты ${p.stats.noCurrency}, без цены ${p.stats.noPrice}; нулевых (уйдут как «нет цены») ${p.stats.zero}`
        + `${p.missing.length ? `; не читаются: ${p.missing.join(', ')}` : ''}${p.tried.length ? `; не сработало: ${p.tried.join(' | ')}` : ''}`,
      fields: [
        { name: 'Виды цен (строк)', properties: [...byType].sort((a, b) => b[1] - a[1]).map(([g, n]) => ({ name: `${priceTypes.get(g) || g}: ${n}`, type: '' })) },
        { name: 'Образец', properties: p.items.slice(0, 10).map(i => ({ name: `${name(i.itemGuid)} · ${priceTypes.get(i.priceTypeGuid) || i.priceTypeGuid} · ${i.price} ${i.currency} · НДС ${i.vatRate}%`, type: '' })) },
      ],
      ms: now() - started,
    })
  }
  catch (e) {
    checks.push({ id: 'prices', title: 'Прайс по видам цен', status: 'fail', detail: reason(e), ms: now() - started })
  }

  started = now()
  try {
    const s = await client.stock()
    await loadNames(s.filter(r => r.available > 0).slice(0, 10).map(r => r.itemGuid))
    const wh = new Map<string, number>()
    for (const r of s) wh.set(r.warehouseName || r.warehouseGuid, (wh.get(r.warehouseName || r.warehouseGuid) ?? 0) + 1)
    checks.push({
      id: 'stock',
      title: `Остатки: ${(input.stockWarehouses ?? DEFAULT_STOCK_WAREHOUSES).join(', ')}`,
      status: s.length ? 'ok' : 'fail',
      detail: `строк: ${s.length}, складов: ${wh.size}, с остатком больше нуля: ${s.filter(r => r.available > 0).length}`,
      fields: [
        { name: 'Склады (строк)', properties: [...wh].sort((a, b) => b[1] - a[1]).map(([n, c]) => ({ name: `${n}: ${c}`, type: '' })) },
        { name: 'Образец', properties: s.filter(r => r.available > 0).slice(0, 10).map(r => ({ name: `${name(r.itemGuid)} · ${r.warehouseName} · ${r.available}`, type: '' })) },
      ],
      ms: now() - started,
    })
  }
  catch (e) {
    checks.push({ id: 'stock', title: 'Остатки по складам', status: 'fail', detail: reason(e), ms: now() - started })
  }
  return checks
}

/**
 * Клиенты и соглашения через клиент OData — тем же сопоставлением, что ЛК: счётчики, из чего
 * состоят соглашения и адреса, образец клиентов. Отчёт копируют в чат: e-mail, телефоны и адреса не
 * показываем, УНП — только «есть/нет», название — только у организаций (у ИП это ФИО, `sampleName`).
 */
export async function runODataClientsProbe(input: ODataProbeInput, now: () => number = Date.now): Promise<ODataCheck[]> {
  const client = new ODataClient({ baseUrl: input.baseUrl, auth: input.auth, fetch: input.fetch, timeoutMs: input.timeoutMs ?? 120_000, onRequest: input.onRequest })
  const started = now()
  try {
    const src = await readClientSources(client)
    const stats = emptyClientStats()
    const today = minskDay(new Date(now()))
    const rows = mapClients(src, today, stats)
    const priceTypes = (await client.names('Catalog_ВидыЦен')).map
    const count = <T>(items: T[], key: (i: T) => string) => {
      const m = new Map<string, number>()
      for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1)
      return [...m].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name: `${name || '—'}: ${n}`, type: '' }))
    }
    const perClient = new Map<string, number>()
    for (const a of src.agreements) if (agreementActive(a, today) && a.Партнер_Key) perClient.set(a.Партнер_Key.toLowerCase(), (perClient.get(a.Партнер_Key.toLowerCase()) ?? 0) + 1)
    const addresses = src.contacts.filter(c => c.Тип === 'Адрес')
    return [{
      id: 'clients',
      title: 'Клиенты по контракту',
      status: rows.length ? 'ok' : 'fail',
      detail: `клиентов: ${stats.clients}, с соглашением: ${stats.clients - stats.noAgreement}, без соглашения: ${stats.noAgreement}, с несколькими действующими: ${stats.manyAgreements} (взято самое позднее), без вида цен: ${stats.noPriceType}, без валюты: ${stats.noCurrency}`
        + `; без УНП: ${stats.noUnp}, без зоны доставки: ${stats.noZone}, без адреса: ${stats.noAddress}, с запретом отгрузки: ${stats.blocked}`,
      fields: [
        { name: 'Статусы соглашений', properties: count(src.agreements, a => `${a.Статус ?? ''}${a.DeletionMark ? ' (удалено)' : ''}`) },
        { name: 'Действующих соглашений у клиента', properties: count([...perClient.values()], n => `${n}`) },
        { name: 'Виды цен в соглашениях', properties: count(rows.flatMap(r => (r.client.contract ? [r.client.contract.priceTypeGuid] : [])), g => priceTypes.get(g) || g) },
        { name: 'Виды адресов (Вид_Key, строк)', properties: count(addresses, c => (c.Вид_Key ?? '').toLowerCase()) },
        { name: 'Зоны доставки (клиентов)', properties: count(rows, r => r.client.region?.name ?? 'без зоны') },
        { name: 'Образец', properties: rows.slice(0, 10).map(({ client: c }) => ({ name: `${sampleName(c.name)} · УНП ${c.unp ? 'есть' : 'нет'} · ${c.region?.name ?? 'без зоны'} · ${c.contract ? `соглашение ${c.contract.number || c.contract.guid} · ${priceTypes.get(c.contract.priceTypeGuid) || 'вид цен ?'} · ${c.contract.currency}` : 'без соглашения'} · адресов ${c.deliveryAddresses.length}${c.shipmentBlocked ? ' · запрет отгрузки' : ''}`, type: '' })) },
      ],
      ms: now() - started,
    }]
  }
  catch (e) {
    return [{ id: 'clients', title: 'Клиенты по контракту', status: 'fail', detail: reason(e), ms: now() - started }]
  }
}

/** Организационно-правовые формы организаций: их название показываем, остальное (ИП — ФИО) — нет. */
const ORG_FORM = /^(?:(?:ООО|ОАО|ЗАО|АО|ПАО|ОДО|ЧУП|ЧТУП|ЧПУП|УП|РУП|КУП|ИООО|СООО)\s*[«"]|(?:Общество с ограниченной ответственностью|Частное (?:торговое )?унитарное предприятие|Унитарное предприятие)\s)/

/** Название клиента для отчёта стенда: организации — как есть, прочее — первые две буквы и длина. */
export function sampleName(name: string): string {
  const n = name.trim()
  return ORG_FORM.test(n) ? n : `${n.slice(0, 2)}… (${n.length} симв.)`
}
