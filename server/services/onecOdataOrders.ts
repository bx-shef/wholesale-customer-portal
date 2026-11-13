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
import { lineAmounts, sumMoney } from '../../shared/vat'
import { assertGuid, EMPTY_REF, ONEC_TZ, orFilters, type ODataClient } from './onecOdata'
import { addressGuid, agreementActive, listAll, type ContactRow } from './onecOdataClients'

export const ORDER_SET = 'Document_ЗаказКлиента'
/** Префикс номера заявки ЛК в `НомерПоДаннымКлиента`: по нему ЛК находит свои заказы. */
export const ORDER_MARK = 'ЛК-'
/** Сколько дней назад смотреть заказы для статусов: старше — уже доставлены или отменены. */
export const ORDER_STATUS_DAYS = 90
/** Хозяйственная операция заказа, если соглашение её не задаёт. */
export const DEFAULT_OPERATION = 'РеализацияКлиенту'

const ref = (v: string | undefined) => (v && v !== EMPTY_REF ? v.toLowerCase() : null)

export interface AgreementForOrder {
  Ref_Key: string
  Партнер_Key?: string
  Валюта_Key?: string
  Договор_Key?: string
  Организация_Key?: string
  Склад_Key?: string
  ВидЦен_Key?: string
  ХозяйственнаяОперация?: string
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

/**
 * Денежные поля строки заказа: цена без НДС, сумма, НДС с суммы и итог с НДС (так считает 1С).
 * Ставки нет (заявка старше хранения ставки) — передаём только цену и сумму: налог 1С посчитает
 * по ставке товара сама, а не мы по нулю.
 */
export function orderLineAmounts(price: number, qty: number, vatRate: number | undefined) {
  if (vatRate === undefined) return { Цена: price, Сумма: lineAmounts(price, qty, 0).sum }
  const a = lineAmounts(price, qty, vatRate)
  return { Цена: price, Сумма: a.sum, СуммаНДС: a.vat, СуммаСНДС: a.total }
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
    // Прайс 1С — без НДС (замечание клиента 2026-11-10): налог сверху, суммы строк — как считает 1С.
    ЦенаВключаетНДС: false,
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
      ...orderLineAmounts(it.price, it.qty, it.vatRate),
      ДатаОтгрузки: shipment,
    })),
    // Итог документа — только когда ставка известна у всех строк, иначе его считает 1С.
    ...(o.items.every(it => it.vatRate !== undefined) ? { СуммаДокумента: sumMoney(o.items.map(it => lineAmounts(it.price, it.qty, it.vatRate!).total)) } : {}),
  }
}

export interface OrderDocRow {
  Ref_Key: string
  Number?: string
  Date?: string
  DataVersion?: string
  DeletionMark?: boolean
  Posted?: boolean
  Статус?: string
  НомерПоДаннымКлиента?: string
  ДатаОтгрузки?: string
  Партнер_Key?: string
}

/**
 * Статус заказа ЛК. Порядок проверок:
 * 1. пометка удаления — `cancelled`;
 * 2. документ не проведён — `new`;
 * 3. состояние заказа из регистра `СостоянияЗаказовКлиентов` (`ORDER_STATE_STATUS`), если оно
 *    известно и знакомо;
 * 4. иначе `Статус` документа: `КОбеспечению` — `confirmed`, `КОтгрузке` — `assembled`,
 *    `Закрыт` — `shipped`.
 * Ответы программиста 1С (2026-11-13) — `facts` от чтения прогона, между шагами 2 и 3:
 * 2а. заказ закрыт и во всех строках «Товары» `Отменено` — `cancelled`;
 * 2б. все задания на перевозку заказа «Закрыто» — `delivered`;
 * 2в. хотя бы одно «Отправлено» или «Закрыто», но не все закрыты — `shipped`.
 */
export function orderStatusOf(d: OrderDocRow, state?: string, facts: OrderFacts = {}): OrderStatusT {
  if (d.DeletionMark) return 'cancelled'
  if (!d.Posted) return 'new'
  if (facts.allLinesCancelled) return 'cancelled'
  if (facts.trip?.status === 'delivered') return 'delivered'
  if (facts.trip?.status === 'shipped') return 'shipped'
  // Состояние из регистра точнее статуса документа: отгруженный заказ остаётся «К обеспечению»
  // (замер 2026-11-11, 00ЦБ-032500 — состояние «Ожидается оплата после отгрузки»).
  // Object.hasOwn: «constructor» и прочие ключи прототипа — не состояние.
  const key = (state ?? '').trim()
  if (Object.hasOwn(ORDER_STATE_STATUS, key)) return ORDER_STATE_STATUS[key]!
  switch ((d.Статус ?? '').trim()) {
    case 'КОбеспечению': return 'confirmed'
    case 'КОтгрузке': return 'assembled'
    case 'Закрыт': return 'shipped'
    default: return 'new'
  }
}

/**
 * Статус ЛК по состоянию заказа (`InformationRegister_СостоянияЗаказовКлиентов.Состояние`,
 * перечисление КА 2.5). Незнакомое значение — откат на `Статус` документа. «Доставлена» — по
 * заданию на перевозку, не из карты состояний.
 */
export const ORDER_STATE_STATUS: Readonly<Record<string, OrderStatusT>> = {
  ОжидаетсяСогласование: 'new',
  НеСогласован: 'new',
  ОжидаетсяПредоплатаДоОбеспечения: 'confirmed',
  ОжидаетсяОбеспечение: 'confirmed',
  ОжидаетсяПредоплатаДоОтгрузки: 'confirmed',
  ГотовКОтгрузке: 'assembled',
  ВПроцессеОтгрузки: 'assembled',
  ОжидаетсяОплатаПослеОтгрузки: 'shipped',
  ГотовКЗакрытию: 'shipped',
  Закрыт: 'shipped',
}

/**
 * Задания на перевозку заказа: все «Закрыто» — `delivered` (дата — самая поздняя из закрытых),
 * иначе при «Отправлено»/«Закрыто» — `shipped` (дата — самая поздняя из них).
 */
export interface OrderTrip { status: 'shipped' | 'delivered', date: string | null }
/** Факты прогона для статуса: отмена всех строк и задание на перевозку. */
export interface OrderFacts { allLinesCancelled?: boolean, trip?: OrderTrip }

/** Строка статуса контракта; не наш заказ (без маркера) — `null`. Дата отгрузки — дата задания, если оно есть. */
export function orderStatusRow(d: OrderDocRow, changedAt: string, state?: string, facts: OrderFacts = {}): OrderStatusRowT | null {
  const mark = (d.НомерПоДаннымКлиента ?? '').trim()
  if (!mark.startsWith(ORDER_MARK)) return null
  const doc = d.ДатаОтгрузки && !d.ДатаОтгрузки.startsWith('0001') ? d.ДатаОтгрузки.slice(0, 10) : null
  const status = orderStatusOf(d, state, facts)
  const ship = (status === 'shipped' || status === 'delivered') && facts.trip?.date ? facts.trip.date : doc
  return {
    orderGuid: d.Ref_Key.toLowerCase(),
    externalId: mark.slice(ORDER_MARK.length),
    number: (d.Number ?? '').trim() || d.Ref_Key,
    status,
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
    'Ref_Key,Партнер_Key,Валюта_Key,Договор_Key,Организация_Key,Склад_Key,ВидЦен_Key,ХозяйственнаяОперация,DeletionMark,Статус,ДатаНачалаДействия,ДатаОкончанияДействия')
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
  const found = new Set<string>()
  for (const $filter of orFilters(items.map(g => `Ref_Key eq guid'${g}'`))) {
    const rows = await client.list<{ Ref_Key: string, СтавкаНДС_Key?: string }>('Catalog_Номенклатура', { $select: 'Ref_Key,СтавкаНДС_Key', $filter })
    for (const r of rows) {
      found.add(r.Ref_Key.toLowerCase())
      if (ref(r.СтавкаНДС_Key)) vat.set(r.Ref_Key.toLowerCase(), r.СтавкаНДС_Key!)
    }
  }
  const missing = items.filter(g => !found.has(g))
  if (missing.length) throw new OnecError('contract', `1C OData order: items not found: ${missing.length}`)
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
    $select: 'Ref_Key,Number,Date,DataVersion,DeletionMark,Posted,Статус,НомерПоДаннымКлиента,ДатаОтгрузки',
    $filter: `Date ge datetime'${since}' and startswith(НомерПоДаннымКлиента, '${ORDER_MARK}')`,
  })
  // Состояния заказов — один раз на прогон и только там, где они что-то меняют: проведённый,
  // не помеченный на удаление и не закрытый документом (закрытый — `shipped` и без регистра).
  // Сбой — откат на `Статус` документа.
  let states: Map<string, string> | undefined
  try {
    states = await readOrderStates(client, docs.filter(d => !d.DeletionMark && d.Posted && (d.Статус ?? '').trim() !== 'Закрыт').map(d => d.Ref_Key.toLowerCase()))
  }
  catch (e) {
    // Без текста ошибки: в нём может быть адрес и фильтр запроса.
    console.warn(`[orders:odata] order states unavailable, fallback to document status: ${(e as Error).name}`)
  }
  // Отмена всех строк — только у закрытых (документ или состояние «Закрыт»). Сбой или нет поля
  // `Отменено` — правило не применяем.
  // Закрытые документом больше `CLOSED_SKIP_DAYS` дней назад — без заданий и строк «Отменено»:
  // статус уже не меняется, а цепочка на 90 днях заказов — лишняя нагрузка на 1С.
  const cutoff = new Date(now.getTime() - CLOSED_SKIP_DAYS * 86_400_000).toISOString().slice(0, 10)
  const settled = (d: OrderDocRow) => (d.Статус ?? '').trim() === 'Закрыт' && !!d.Date && d.Date.slice(0, 10) < cutoff
  const live = docs.filter(d => !d.DeletionMark && d.Posted && !settled(d))
  const keyOf = (d: OrderDocRow) => d.Ref_Key.toLowerCase()
  let cancelled = new Set<string>()
  try {
    cancelled = await readAllLinesCancelled(client, live.filter(d => (d.Статус ?? '').trim() === 'Закрыт' || states?.get(keyOf(d)) === 'Закрыт').map(keyOf))
  }
  catch (e) {
    console.warn(`[orders:odata] order lines cancel flag unavailable, rule skipped: ${(e as Error).name}`)
  }
  // Задания на перевозку — один проход цепочки на прогон: «Отправлено»/«Закрыто» для заказов в
  // отгрузке и после, и «точно приедет» (кандидаты — состояние «Готов к закрытию» или документ
  // «К выполнению»; без регистра — не подтверждаем). Сбой не роняет статусы.
  let shipping: Shipping = { confirmed: new Set(), trips: new Map() }
  const confirmable = new Set(states ? live.filter(d => STATE_READY.has(states?.get(keyOf(d)) ?? '') || ORDER_IN_WORK.has((d.Статус ?? '').trim())).map(keyOf) : [])
  const tripCandidates = live.filter((d) => {
    if (cancelled.has(keyOf(d))) return false
    const base = orderStatusOf(d, states?.get(keyOf(d)))
    return confirmable.has(keyOf(d)) || base === 'assembled' || base === 'shipped'
  }).map(keyOf)
  try {
    shipping = await readShipping(client, tripCandidates, confirmable, states)
  }
  catch (e) {
    // Без текста ошибки: в нём может быть адрес и фильтр запроса.
    console.error(`[orders:odata] trips of orders unavailable: ${(e as Error).name}`)
  }
  return docs.flatMap((d) => {
    const k = keyOf(d)
    const row = orderStatusRow(d, `2000-01-01T00:00:00${ONEC_TZ}`, states?.get(k), { allLinesCancelled: cancelled.has(k), trip: shipping.trips.get(k) })
    if (!row) return []
    row.deliveryConfirmed = shipping.confirmed.has(row.orderGuid)
    // Без DataVersion — пустая версия: такой заказ считается изменённым на каждом прогоне.
    // Подтверждение доставки и задание (статус, дата) — в версии через статус и дату отгрузки:
    // меняются по другим документам, а не по заказу.
    return [{ row, version: d.DataVersion ? `${d.DataVersion}|${row.status}|${row.shipmentDate ?? ''}|${row.deliveryConfirmed ? 1 : 0}` : '' }]
  })
}

/**
 * Заказы, у которых в табличной части «Товары» есть строки и все отменены (`Отменено`).
 * Поля нет — 1С отвечает ошибкой на `$select`, вызывающий правило пропускает.
 */
export async function readAllLinesCancelled(client: ODataClient, orders: string[]): Promise<Set<string>> {
  const lines = new Map<string, { all: number, off: number }>()
  for (const $filter of orFilters(orders.map(g => `Ref_Key eq guid'${assertGuid(g)}'`))) {
    const rows = await client.list<{ Ref_Key: string, Отменено?: boolean }>('Document_ЗаказКлиента_Товары', { $select: 'Ref_Key,Отменено', $filter })
    for (const r of rows) {
      const k = r.Ref_Key.toLowerCase()
      const c = lines.get(k) ?? { all: 0, off: 0 }
      c.all++
      if (r.Отменено === true) c.off++
      lines.set(k, c)
    }
  }
  return new Set([...lines].filter(([, c]) => c.off === c.all).map(([k]) => k))
}

/** Закрытый документом заказ старше стольких дней (по дате документа) по цепочке заданий не проверяем. */
export const CLOSED_SKIP_DAYS = 30

/** Заказ «К выполнению»: в ERP значение перечисления — `КОтгрузке` (в интерфейсе «К выполнению»). */
export const ORDER_IN_WORK = new Set(['КВыполнению', 'КОтгрузке'])
const STATE_READY = new Set(['ГотовКЗакрытию'])
const ISSUE_READY = 'КОтгрузке'
const TRIP_CLOSED = 'Закрыто'
/** Задание «Отправлено» (в интерфейсе 1С так же; имя значения перечисления не сверено на живой базе). */
const TRIP_SENT = 'Отправлено'
const orderRef = (g: string) => `cast(guid'${assertGuid(g)}', 'Document_ЗаказКлиента')`

/** Состояние заказов из регистра `СостоянияЗаказовКлиентов`: заказ (строчными) → `Состояние`. */
export async function readOrderStates(client: ODataClient, orders: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const $filter of orFilters(orders.map(g => `Заказ eq ${orderRef(g)}`))) {
    const rows = await client.list<{ Заказ?: string, Состояние?: string }>('InformationRegister_СостоянияЗаказовКлиентов', { $select: 'Заказ,Состояние', $filter })
    for (const r of rows) if (r.Заказ) out.set(r.Заказ.toLowerCase(), (r.Состояние ?? '').trim())
  }
  return out
}

/** Итог цепочки заказ → расходный ордер → задание на перевозку. */
export interface Shipping { confirmed: Set<string>, trips: Map<string, OrderTrip> }

/**
 * Заказы с подтверждённой доставкой (решение клиента 2026-10-27), все четыре условия:
 * заказ «К выполнению» (отбирает вызывающий), состояние заказа «Готов к закрытию»,
 * расходный ордер по заказу «К отгрузке» и его задание на перевозку «Закрыто».
 */
export async function readDeliveryConfirmed(client: ODataClient, orders: string[], states?: Map<string, string>): Promise<Set<string>> {
  if (!orders.length) return new Set()
  const known = states ?? await readOrderStates(client, orders)
  return (await readShipping(client, orders.filter(g => STATE_READY.has(known.get(g.toLowerCase()) ?? '')), new Set(orders.map(g => g.toLowerCase())), known)).confirmed
}

/**
 * Один проход цепочки заказ → расходный ордер → задание на перевозку (ответы программиста 1С,
 * 2026-11-13). `trips`: задание «Закрыто» — `delivered`, только если ВСЕ непомеченные на удаление
 * задания заказа «Закрыто»; иначе при «Отправлено»/«Закрыто» — `shipped`. Дата — `Date` задания:
 * у `delivered` самая поздняя из закрытых, у `shipped` — из «Отправлено»/«Закрыто». `confirmed` — «точно приедет»
 * для заказов из `confirmable` с состоянием «Готов к закрытию» и ордером «К отгрузке».
 */
export async function readShipping(client: ODataClient, orders: string[], confirmable: Set<string>, states?: Map<string, string>): Promise<Shipping> {
  const out: Shipping = { confirmed: new Set(), trips: new Map() }
  if (!orders.length) return out
  // 1. Расходные ордера по заказу — строки «Товары по распоряжениям».
  const issueOf = new Map<string, Set<string>>()
  for (const $filter of orFilters(orders.map(g => `Распоряжение eq ${orderRef(g)}`))) {
    const rows = await client.list<{ Ref_Key: string, Распоряжение?: string }>('Document_РасходныйОрдерНаТовары_ТоварыПоРаспоряжениям', { $select: 'Ref_Key,Распоряжение', $filter })
    for (const r of rows) {
      const g = (r.Распоряжение ?? '').toLowerCase()
      if (!issueOf.has(g)) issueOf.set(g, new Set())
      issueOf.get(g)!.add(r.Ref_Key.toLowerCase())
    }
  }
  const issues = [...new Set([...issueOf.values()].flatMap(s => [...s]))]
  if (!issues.length) return out
  // 2. Ордер проведён и с заданием на перевозку; «К отгрузке» — для «точно приедет».
  const tripOfIssue = new Map<string, { trip: string, ready: boolean }>()
  for (const $filter of orFilters(issues.map(g => `Ref_Key eq guid'${assertGuid(g)}'`))) {
    const rows = await client.list<{ Ref_Key: string, Статус?: string, Posted?: boolean, DeletionMark?: boolean, ЗаданиеНаПеревозку_Key?: string }>('Document_РасходныйОрдерНаТовары', { $select: 'Ref_Key,Статус,Posted,DeletionMark,ЗаданиеНаПеревозку_Key', $filter })
    for (const r of rows) {
      const trip = (r.ЗаданиеНаПеревозку_Key ?? '').toLowerCase()
      if (r.Posted && !r.DeletionMark && trip && trip !== EMPTY_REF) tripOfIssue.set(r.Ref_Key.toLowerCase(), { trip, ready: (r.Статус ?? '').trim() === ISSUE_READY })
    }
  }
  const tripIds = [...new Set([...tripOfIssue.values()].map(t => t.trip))]
  if (!tripIds.length) return out
  // 3. Статус и дата задания.
  const tripState = new Map<string, { status: 'delivered' | 'shipped' | 'other', date: string | null }>()
  for (const $filter of orFilters(tripIds.map(g => `Ref_Key eq guid'${assertGuid(g)}'`))) {
    const rows = await client.list<{ Ref_Key: string, Статус?: string, Date?: string, DeletionMark?: boolean }>('Document_ЗаданиеНаПеревозку', { $select: 'Ref_Key,Статус,Date,DeletionMark', $filter })
    for (const r of rows) {
      if (r.DeletionMark) continue
      const st = (r.Статус ?? '').trim()
      // Прочие статусы («Формируется», «К погрузке») тоже помним: с ними заказ не доставлен.
      const status = st === TRIP_CLOSED ? 'delivered' : st === TRIP_SENT ? 'shipped' : 'other'
      tripState.set(r.Ref_Key.toLowerCase(), { status, date: r.Date && !r.Date.startsWith('0001') ? r.Date.slice(0, 10) : null })
    }
  }
  for (const [order, set] of issueOf) {
    const seen = new Map<string, { status: 'delivered' | 'shipped' | 'other', date: string | null }>()
    for (const i of set) {
      const link = tripOfIssue.get(i)
      const t = link && tripState.get(link.trip)
      if (!link || !t) continue
      seen.set(link.trip, t)
      if (t.status === 'delivered' && link.ready && confirmable.has(order) && STATE_READY.has(states?.get(order) ?? '')) out.confirmed.add(order)
    }
    const trip = aggregateTrips([...seen.values()])
    if (trip) out.trips.set(order, trip)
  }
  return out
}

/** Итог по заданиям заказа: все «Закрыто» — delivered, иначе есть движение — shipped. */
export function aggregateTrips(trips: Array<{ status: 'delivered' | 'shipped' | 'other', date: string | null }>): OrderTrip | undefined {
  const moved = trips.filter(t => t.status !== 'other')
  if (!moved.length) return undefined
  const latest = (xs: typeof trips) => xs.reduce<string | null>((m, t) => (t.date && (!m || t.date > m) ? t.date : m), null)
  if (moved.length === trips.length && trips.every(t => t.status === 'delivered')) return { status: 'delivered', date: latest(trips) }
  return { status: 'shipped', date: latest(moved) }
}
