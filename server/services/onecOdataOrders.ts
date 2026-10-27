/**
 * Заказы 1С по OData (docs/onec-odata.md, «Заказ из ЛК»): запись `Document_ЗаказКлиента` по заявке
 * ЛК и статусы заказов в форме контракта. Документ пишется **непроведённым**: OData минует формы
 * и согласование 1С, а проведение сразу резервирует товар — согласует и проводит менеджер в 1С
 * (ревью PR #65). Чистые части — `orderBody`, `orderStatusOf`,
 * `orderMarker`; чтение и запись — `createOdataOrder`, `readOrderStatuses`.
 *
 * Повтор без дубля: номер заявки ЛК пишется в `НомерПоДаннымКлиента` (`ЛК-<externalId>`), перед
 * записью ищем документ с ним. Тестовый заказ стенда (`test: true`) проверяет все ссылки и
 * документ не создаёт (onec-contract.md §1.7).
 *
 * Значения перечислений 1С (`Статус`, `ХозяйственнаяОперация`) взяты из типовой конфигурации и
 * не проверены на тестовой базе — проверить стендом до включения `ONEC_ODATA_ORDERS`.
 */
import { createHash } from 'node:crypto'
import { OrderCreated, OrderRequest, type OrderStatusRowT, type OrderStatusT } from '../../shared/onec/schemas'
import type { z } from 'zod'
import { OnecError } from './onec'
import { assertGuid, EMPTY_REF, ONEC_TZ, type ODataClient } from './onecOdata'
import { addressGuid, agreementActive, listAll, type ContactRow } from './onecOdataClients'

export const ORDER_SET = 'Document_ЗаказКлиента'
/** Префикс номера заявки ЛК в `НомерПоДаннымКлиента`: по нему ЛК находит свои заказы. */
export const ORDER_MARK = 'ЛК-'
/** Сколько дней назад смотреть заказы для статусов: старше — уже доставлены или отменены. */
export const ORDER_STATUS_DAYS = 90
/** Хозяйственная операция заказа, если соглашение её не задаёт. */
export const DEFAULT_OPERATION = 'РеализацияКлиенту'

const ref = (v: string | undefined) => (v && v !== EMPTY_REF ? v.toLowerCase() : null)
const money = (v: number) => Math.round(v * 100) / 100

export interface AgreementForOrder {
  Ref_Key: string
  Партнер_Key?: string
  Валюта_Key?: string
  Договор_Key?: string
  Организация_Key?: string
  Склад_Key?: string
  ВидЦен_Key?: string
  ХозяйственнаяОперация?: string
  ЦенаВключаетНДС?: boolean
  DeletionMark?: boolean
  Статус?: string
  ДатаНачалаДействия?: string
  ДатаОкончанияДействия?: string
}

export interface OrderRefs {
  agreement: AgreementForOrder
  counterparty: string
  warehouse: string
  zone: string | null
  address: string
  vat: Map<string, string>
}

/**
 * Маркер заявки ЛК в 1С. `externalId` — ID сделки Б24: только безопасные символы (кавычки в фильтр
 * не попадут) и не длиннее 37 — маркер (`ЛК-` + номер, до 40 знаков) должен влезть в
 * `НомерПоДаннымКлиента` без обрезки, иначе повтор документ не найдёт и запишет второй.
 */
export function orderMarker(externalId: string): string {
  if (!/^[\w-]{1,37}$/.test(externalId)) throw new OnecError('contract', '1C OData order: externalId has unsafe characters')
  return `${ORDER_MARK}${externalId}`
}

/** GUID тестового заказа: документ не создаётся, а контракт требует GUID — детерминирован от заявки. */
export function testOrderGuid(externalId: string): string {
  const h = createHash('sha1').update(`test-order|${externalId}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** Тело `Document_ЗаказКлиента` по заявке и найденным ссылкам. Пустые ссылки не передаём. */
export function orderBody(o: z.infer<typeof OrderRequest>, refs: OrderRefs, now: Date): Record<string, unknown> {
  const a = refs.agreement
  const shipment = `${o.deliveryDate}T00:00:00`
  const keys = (fields: Record<string, string | null | undefined>) =>
    Object.fromEntries(Object.entries(fields).filter(([, v]) => v && v !== EMPTY_REF))
  return {
    Date: new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 19),
    ...keys({
      Партнер_Key: o.clientGuid,
      Контрагент_Key: refs.counterparty,
      Соглашение_Key: o.contractGuid,
      Договор_Key: a.Договор_Key,
      Организация_Key: a.Организация_Key,
      Склад_Key: refs.warehouse,
      Валюта_Key: a.Валюта_Key,
      ЗонаДоставки_Key: refs.zone,
    }),
    ХозяйственнаяОперация: a.ХозяйственнаяОперация || DEFAULT_OPERATION,
    ЦенаВключаетНДС: a.ЦенаВключаетНДС ?? true,
    ДатаОтгрузки: shipment,
    АдресДоставки: o.deliveryAddressText || refs.address,
    Комментарий: o.comment ?? '',
    НомерПоДаннымКлиента: orderMarker(o.externalId),
    Товары: o.items.map((it, i) => ({
      LineNumber: String(i + 1),
      Номенклатура_Key: it.itemGuid,
      Количество: it.qty,
      КоличествоУпаковок: it.qty,
      ...keys({ ВидЦены_Key: a.ВидЦен_Key, СтавкаНДС_Key: refs.vat.get(it.itemGuid.toLowerCase()), Склад_Key: refs.warehouse }),
      Цена: it.price,
      Сумма: money(it.price * it.qty),
      ДатаОтгрузки: shipment,
    })),
  }
}

export interface OrderDocRow {
  Ref_Key: string
  Number?: string
  DataVersion?: string
  DeletionMark?: boolean
  Posted?: boolean
  Статус?: string
  НомерПоДаннымКлиента?: string
  ДатаОтгрузки?: string
  Партнер_Key?: string
}

/**
 * Статус заказа ЛК по документу 1С. «Отгружен» и «доставлен» 1С знает по реализации и рейсу —
 * они ещё не опубликованы; пока «Закрыт» — это `shipped`, дальше статус ведёт рейс. Закрытый без
 * отгрузки (отказ) так не отличить — проверить на тестовой базе, как 1С закрывает отказы.
 */
export function orderStatusOf(d: OrderDocRow): OrderStatusT {
  if (d.DeletionMark) return 'cancelled'
  if (!d.Posted) return 'new'
  switch ((d.Статус ?? '').trim()) {
    case 'КОбеспечению': return 'confirmed'
    case 'КОтгрузке': return 'assembled'
    case 'Закрыт': return 'shipped'
    default: return 'new'
  }
}

/** Строка статуса контракта; не наш заказ (без маркера) — `null`. */
export function orderStatusRow(d: OrderDocRow, changedAt: string): OrderStatusRowT | null {
  const mark = (d.НомерПоДаннымКлиента ?? '').trim()
  if (!mark.startsWith(ORDER_MARK)) return null
  const ship = d.ДатаОтгрузки && !d.ДатаОтгрузки.startsWith('0001') ? d.ДатаОтгрузки.slice(0, 10) : null
  return {
    orderGuid: d.Ref_Key.toLowerCase(),
    externalId: mark.slice(ORDER_MARK.length),
    number: (d.Number ?? '').trim() || d.Ref_Key,
    status: orderStatusOf(d),
    shipmentDate: ship,
    tripGuid: null,
    deliveryConfirmed: false,
    changedAt,
  }
}

const one = async <T>(client: ODataClient, set: string, filter: string, select: string, orderby?: string): Promise<T | undefined> =>
  (await client.list<T>(set, { $select: select, $filter: filter, $top: 1, ...(orderby ? { $orderby: orderby } : {}) }))[0]

/** Ссылки для документа: соглашение клиента, контрагент, склад, зона, текст адреса, ставки НДС. */
export async function resolveOrderRefs(client: ODataClient, o: z.infer<typeof OrderRequest>, opts: { warehouseNames: string[], today: string }): Promise<OrderRefs> {
  const partner = assertGuid(o.clientGuid).toLowerCase()
  const agreement = await one<AgreementForOrder>(client, 'Catalog_СоглашенияСКлиентами', `Ref_Key eq guid'${assertGuid(o.contractGuid)}'`,
    'Ref_Key,Партнер_Key,Валюта_Key,Договор_Key,Организация_Key,Склад_Key,ВидЦен_Key,ХозяйственнаяОперация,ЦенаВключаетНДС,DeletionMark,Статус,ДатаНачалаДействия,ДатаОкончанияДействия')
  // Соглашение чужого клиента — отказ: заказ ушёл бы по чужим условиям.
  if (!agreement || ref(agreement.Партнер_Key) !== partner) throw new OnecError('contract', '1C OData order: agreement does not belong to the client')
  if (!agreementActive(agreement, opts.today)) throw new OnecError('contract', '1C OData order: agreement is not active')
  const cps = await client.list<{ Ref_Key: string, DeletionMark?: boolean }>('Catalog_Контрагенты', { $select: 'Ref_Key,DeletionMark', $filter: `Партнер_Key eq guid'${partner}'` })
  const counterparty = cps.find(c => !c.DeletionMark)?.Ref_Key
  if (!counterparty) throw new OnecError('contract', '1C OData order: client has no counterparty')
  let warehouse = ref(agreement.Склад_Key)
  if (!warehouse) {
    const { map } = await client.names('Catalog_Склады')
    const want = opts.warehouseNames.map(n => n.trim().toLowerCase())
    warehouse = [...map].find(([, n]) => want.includes(n.trim().toLowerCase()))?.[0] ?? null
  }
  if (!warehouse) throw new OnecError('contract', '1C OData order: warehouse not found')
  const p = await one<{ ЗонаДоставки_Key?: string }>(client, 'Catalog_Партнеры', `Ref_Key eq guid'${partner}'`, 'Ref_Key,ЗонаДоставки_Key')
  const contacts = await listAll<ContactRow>(client, 'Catalog_Партнеры_КонтактнаяИнформация', { $select: 'Ref_Key,LineNumber,Тип,Вид_Key,Представление,Город', $filter: `Ref_Key eq guid'${partner}'` }, 'Ref_Key,LineNumber')
  const want = assertGuid(o.deliveryAddressGuid).toLowerCase()
  const row = contacts.find(c => (c.Тип ?? '').trim() === 'Адрес' && addressGuid(partner, ref(c.Вид_Key) ?? '', `${(c.Город ?? '').trim()}|${(c.Представление ?? '').trim()}`) === want)
  if (!row) throw new OnecError('contract', '1C OData order: delivery address not found')
  const vat = new Map<string, string>()
  const items = [...new Set(o.items.map(i => assertGuid(i.itemGuid).toLowerCase()))]
  for (let i = 0; i < items.length; i += 40) {
    const rows = await client.list<{ Ref_Key: string, СтавкаНДС_Key?: string }>('Catalog_Номенклатура', {
      $select: 'Ref_Key,СтавкаНДС_Key',
      $filter: items.slice(i, i + 40).map(g => `Ref_Key eq guid'${g}'`).join(' or '),
    })
    for (const r of rows) if (ref(r.СтавкаНДС_Key)) vat.set(r.Ref_Key.toLowerCase(), r.СтавкаНДС_Key!)
    const missing = items.slice(i, i + 40).filter(g => !rows.some(r => r.Ref_Key.toLowerCase() === g))
    if (missing.length) throw new OnecError('contract', `1C OData order: items not found: ${missing.length}`)
  }
  return { agreement, counterparty, warehouse, zone: ref(p?.ЗонаДоставки_Key), address: (row.Представление ?? '').trim(), vat }
}

/**
 * Создать заказ по заявке ЛК (§2.6). Тестовый заказ (`test: true`) проверяет все ссылки и ничего не
 * пишет — даже когда запись заказов выключена. Настоящий: уже есть документ с этим номером заявки —
 * вернуть его, не создавая второй (несколько — самый ранний по номеру); нет — записать непроведённым.
 * `enabled: false` — запись выключена (`ONEC_ODATA_ORDERS`): отказ для любого вызывающего, включая MCP.
 */
export async function createOdataOrder(client: ODataClient, input: z.input<typeof OrderRequest>, opts: { warehouseNames: string[], enabled: boolean, now?: Date }): Promise<z.infer<typeof OrderCreated>> {
  const o = OrderRequest.parse(input)
  const mark = orderMarker(o.externalId)
  const now = opts.now ?? new Date()
  const today = new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)
  // Резерв ставит 1С при проведении менеджером; по OData его не узнать — расхождением не считаем.
  const facts = o.items.map(i => ({ itemGuid: i.itemGuid, price: i.price, reserved: i.qty }))
  if (o.test) {
    await resolveOrderRefs(client, o, { warehouseNames: opts.warehouseNames, today })
    return OrderCreated.parse({ orderGuid: testOrderGuid(o.externalId), number: `ТЕСТ-${o.externalId}`, status: 'new', items: facts })
  }
  if (!opts.enabled) throw new OnecError('http', '1C OData order: writing orders is off (ONEC_ODATA_ORDERS)', 501)
  const existing = await one<OrderDocRow>(client, ORDER_SET, `НомерПоДаннымКлиента eq '${mark}'`, 'Ref_Key,Number,DeletionMark,Posted,Статус,НомерПоДаннымКлиента,Партнер_Key', 'Number')
  if (existing) {
    // Чужой заказ с тем же номером заявки — не отдаём: показали бы его другому клиенту.
    if (ref(existing.Партнер_Key) !== o.clientGuid.toLowerCase()) throw new OnecError('http', '1C OData order: externalId already used by another client', 409)
    return OrderCreated.parse({ orderGuid: existing.Ref_Key.toLowerCase(), number: (existing.Number ?? '').trim() || mark, status: orderStatusOf(existing), items: facts })
  }
  const refs = await resolveOrderRefs(client, o, { warehouseNames: opts.warehouseNames, today })
  const created = await client.send<OrderDocRow>('POST', encodeURIComponent(ORDER_SET), ORDER_SET, orderBody(o, refs, now))
  if (!created?.Ref_Key) throw new OnecError('contract', '1C OData order: no Ref_Key in response')
  return OrderCreated.parse({ orderGuid: assertGuid(created.Ref_Key).toLowerCase(), number: (created.Number ?? '').trim() || mark, status: 'new', items: facts })
}

/** Заказы ЛК за `ORDER_STATUS_DAYS` дней с версией документа — для статусов (§2.7). */
export async function readOrderStatuses(client: ODataClient, now: Date): Promise<Array<{ row: OrderStatusRowT, version: string }>> {
  const since = new Date(now.getTime() - ORDER_STATUS_DAYS * 86_400_000 + 3 * 3_600_000).toISOString().slice(0, 19)
  const docs = await listAll<OrderDocRow>(client, ORDER_SET, {
    $select: 'Ref_Key,Number,DataVersion,DeletionMark,Posted,Статус,НомерПоДаннымКлиента,ДатаОтгрузки',
    $filter: `Date ge datetime'${since}' and startswith(НомерПоДаннымКлиента, '${ORDER_MARK}')`,
  })
  // «Точно приедет»: проверяем только заказы «К выполнению»; сбой сверки не роняет статусы.
  let confirmed = new Set<string>()
  try {
    confirmed = await readDeliveryConfirmed(client, docs.filter(d => !d.DeletionMark && d.Posted && ORDER_IN_WORK.has((d.Статус ?? '').trim())).map(d => d.Ref_Key.toLowerCase()))
  }
  catch (e) {
    console.error(`[orders:odata] delivery confirmed: ${(e as Error).message.slice(0, 200)}`)
  }
  return docs.flatMap((d) => {
    const row = orderStatusRow(d, `2000-01-01T00:00:00${ONEC_TZ}`)
    if (!row) return []
    row.deliveryConfirmed = confirmed.has(row.orderGuid)
    // Без DataVersion — пустая версия: такой заказ считается изменённым на каждом прогоне.
    // Подтверждение доставки — в версии: меняется по другим документам, а не по заказу.
    return [{ row, version: d.DataVersion ? `${d.DataVersion}|${row.status}|${row.shipmentDate ?? ''}|${row.deliveryConfirmed ? 1 : 0}` : '' }]
  })
}

/** Заказ «К выполнению»: в ERP значение перечисления — `КОтгрузке` (в интерфейсе «К выполнению»). */
export const ORDER_IN_WORK = new Set(['КВыполнению', 'КОтгрузке'])
const STATE_READY = new Set(['ГотовКЗакрытию'])
const ISSUE_READY = 'КОтгрузке'
const TRIP_CLOSED = 'Закрыто'
const BATCH = 20
const orderRef = (g: string) => `cast(guid'${assertGuid(g)}', 'Document_ЗаказКлиента')`

/**
 * Заказы с подтверждённой доставкой (решение клиента 2026-10-27), все четыре условия:
 * заказ «К выполнению» (отбирает вызывающий), состояние заказа «Готов к закрытию»,
 * расходный ордер по заказу «К отгрузке» и его задание на перевозку «Закрыто».
 */
export async function readDeliveryConfirmed(client: ODataClient, orders: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (!orders.length) return out
  // 1. Состояние заказа — регистр сведений, ключ — заказ.
  const ready: string[] = []
  for (let i = 0; i < orders.length; i += BATCH) {
    const rows = await client.list<{ Заказ?: string, Состояние?: string }>('InformationRegister_СостоянияЗаказовКлиентов', {
      $select: 'Заказ,Состояние',
      $filter: orders.slice(i, i + BATCH).map(g => `Заказ eq ${orderRef(g)}`).join(' or '),
    })
    for (const r of rows) if (r.Заказ && STATE_READY.has((r.Состояние ?? '').trim())) ready.push(r.Заказ.toLowerCase())
  }
  if (!ready.length) return out
  // 2. Расходные ордера по заказу — строки «Товары по распоряжениям».
  const issueOf = new Map<string, Set<string>>()
  for (let i = 0; i < ready.length; i += BATCH) {
    const rows = await client.list<{ Ref_Key: string, Распоряжение?: string }>('Document_РасходныйОрдерНаТовары_ТоварыПоРаспоряжениям', {
      $select: 'Ref_Key,Распоряжение',
      $filter: ready.slice(i, i + BATCH).map(g => `Распоряжение eq ${orderRef(g)}`).join(' or '),
    })
    for (const r of rows) {
      const g = (r.Распоряжение ?? '').toLowerCase()
      if (!issueOf.has(g)) issueOf.set(g, new Set())
      issueOf.get(g)!.add(r.Ref_Key.toLowerCase())
    }
  }
  const issues = [...new Set([...issueOf.values()].flatMap(s => [...s]))]
  if (!issues.length) return out
  // 3. Ордер «К отгрузке», проведён и с заданием на перевозку.
  const tripOfIssue = new Map<string, string>()
  for (let i = 0; i < issues.length; i += BATCH) {
    const rows = await client.list<{ Ref_Key: string, Статус?: string, Posted?: boolean, DeletionMark?: boolean, ЗаданиеНаПеревозку_Key?: string }>('Document_РасходныйОрдерНаТовары', {
      $select: 'Ref_Key,Статус,Posted,DeletionMark,ЗаданиеНаПеревозку_Key',
      $filter: issues.slice(i, i + BATCH).map(g => `Ref_Key eq guid'${assertGuid(g)}'`).join(' or '),
    })
    for (const r of rows) {
      const trip = (r.ЗаданиеНаПеревозку_Key ?? '').toLowerCase()
      if (r.Posted && !r.DeletionMark && (r.Статус ?? '').trim() === ISSUE_READY && trip && trip !== EMPTY_REF) tripOfIssue.set(r.Ref_Key.toLowerCase(), trip)
    }
  }
  const trips = [...new Set(tripOfIssue.values())]
  if (!trips.length) return out
  // 4. Задание на перевозку «Закрыто».
  const closed = new Set<string>()
  for (let i = 0; i < trips.length; i += BATCH) {
    const rows = await client.list<{ Ref_Key: string, Статус?: string, DeletionMark?: boolean }>('Document_ЗаданиеНаПеревозку', {
      $select: 'Ref_Key,Статус,DeletionMark',
      $filter: trips.slice(i, i + BATCH).map(g => `Ref_Key eq guid'${assertGuid(g)}'`).join(' or '),
    })
    for (const r of rows) if (!r.DeletionMark && (r.Статус ?? '').trim() === TRIP_CLOSED) closed.add(r.Ref_Key.toLowerCase())
  }
  for (const [order, set] of issueOf) if ([...set].some(i => closed.has(tripOfIssue.get(i) ?? ''))) out.add(order)
  return out
}
