/**
 * Мок HTTP-сервиса 1С по контракту `shared/onec/schemas.ts`. Чистое ядро без h3: запрос →
 * `{ status, body, delayMs }`. Его оборачивают маршрут `server/routes/mock-1c/[...path].ts`
 * (для программиста 1С и внешних тестов) и клиент ЛК в режиме `ONEC_MOCK=true`.
 *
 * Поведение (docs/spec.md §6): остатки меняются между запросами, заказ сам проходит статусы
 * по времени, включаются задержка и 5xx. Время приходит параметром — тесты двигают его сами.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { generateSeed, guidFrom, prng, round2, SEED_EPOCH, type SeedData } from './seed'
import {
  ERROR_CODES, ListQuery, OrderRequest,
  type ClientT, type ErrorCode, type OrderLineFactT, type OrderStatusT, type PriceT, type StockT, type TripT,
} from '../../../shared/onec/schemas'

export interface MockRequest {
  method: string
  /** Путь без префикса `/mock-1c`, например `/clients` или `/client/<guid>/contract`. */
  path: string
  query: Record<string, string | undefined>
  body?: unknown
  authorization?: string | null
}

export interface MockResponse {
  status: number
  body: unknown
  /** Задержка, которую обёртка выдержит перед ответом (режим «медленная 1С»). */
  delayMs: number
}

export interface MockMode {
  delayMs: number
  /** Доля запросов, отвечающих 503 (0..1). */
  failRate: number
  /** Сколько следующих запросов ответят 503 — детерминированно, для тестов повторов. */
  failNext: number
}

interface MockOrder {
  orderGuid: string
  externalId: string
  clientGuid: string
  number: string
  createdAt: number
  /** Момент отмены, мс эпохи: он же changedAt — иначе синхронизация по курсору отмену не увидит. */
  cancelledAt: number | null
  /** Факт по строкам (§2.6): цена прайса договора и резерв из свободного остатка. */
  lines: OrderLineFactT[]
  /** Заказ со стенда (`test: true`, docs/onec-contract.md §1.7): не виден в /orders/status. */
  test: boolean
}

export interface MockState {
  token: string
  seed: number
  /** Демо-клиенты из `ONEC_MOCK_CLIENTS`: `_admin/reset` создаёт их заново. */
  demoClients: string[]
  data: SeedData
  /** Момент изменения остатка: ключ `itemGuid|warehouseGuid`, мс эпохи. */
  stockChangedAt: Map<string, number>
  /** Когда менялась цена товара (`_admin/price`), ISO: прайс отдаёт его как changedAt. */
  priceChangedAt: Map<string, string>
  orders: Map<string, MockOrder>
  ordersByExternalId: Map<string, MockOrder>
  stockTicks: number
  mode: MockMode
  rand: () => number
}

/**
 * Через сколько секунд после создания заказ переходит в статус. Демо видит весь путь за
 * несколько минут; `delivered` — конечный.
 */
export const ORDER_TIMELINE: [OrderStatusT, number][] = [
  ['new', 0], ['confirmed', 60], ['assembled', 180], ['shipped', 300], ['delivered', 600],
]

const SHIPPED_AFTER_SEC = ORDER_TIMELINE.find(([status]) => status === 'shipped')![1]

export function createMockState(token: string, seed = 1, demoClients: string[] = []): MockState {
  const data = generateSeed(seed, demoClients, new Date().toISOString())
  const epoch = Date.parse(SEED_EPOCH) + 86_400_000
  return {
    token,
    seed,
    demoClients,
    data,
    stockChangedAt: new Map([...data.stock.keys()].map(k => [k, epoch])),
    priceChangedAt: new Map(),
    orders: new Map(),
    ordersByExternalId: new Map(),
    stockTicks: 0,
    mode: { delayMs: 0, failRate: 0, failNext: 0 },
    rand: prng(seed ^ 0x5eed),
  }
}

function error(code: ErrorCode, message: string, delayMs = 0): MockResponse {
  return { status: ERROR_CODES[code], body: { error: code, message }, delayMs }
}

/** Страница по номеру; `nextPage` — null на последней. */
function paginate<T>(rows: T[], pageNo: number, pageSize: number) {
  const start = (pageNo - 1) * pageSize
  const items = rows.slice(start, start + pageSize)
  return { items, nextPage: start + pageSize < rows.length ? pageNo + 1 : null }
}

/** Сортировка для стабильной пагинации: по моменту изменения, затем по ключу. */
function byChange<T>(rows: T[], at: (r: T) => string, key: (r: T) => string): T[] {
  return [...rows].sort((a, b) => at(a).localeCompare(at(b)) || key(a).localeCompare(key(b)))
}

function orderStatusAt(order: MockOrder, now: number): { status: OrderStatusT, changedAt: number } {
  if (order.cancelledAt !== null) return { status: 'cancelled', changedAt: order.cancelledAt }
  let current: [OrderStatusT, number] = ORDER_TIMELINE[0]!
  for (const step of ORDER_TIMELINE) if (now >= order.createdAt + step[1] * 1000) current = step
  return { status: current[0], changedAt: order.createdAt + current[1] * 1000 }
}

/** GUID рейса из региона и даты: один рейс на регион в день, как задание на перевозку по направлению. */
function tripGuid(regionGuid: string, date: string): string {
  const h = createHash('sha1').update(`${regionGuid}|${date}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/**
 * Задания на перевозку мока: собранный заказ попадает в рейс своего региона на дату отгрузки;
 * статус рейса идёт за статусом заказа (собран → к погрузке, отгружен → отправлено, доставлен →
 * закрыто). Плюс по пустому формируемому рейсу на завтра в каждый регион — вкладке Б24 есть что показать.
 */
function mockTrips(state: MockState, now: number): TripT[] {
  const trips = new Map<string, TripT>()
  const dayStart = new Date(now).toISOString().slice(0, 10)
  const tomorrow = new Date(Date.parse(dayStart) + 86_400_000).toISOString().slice(0, 10)
  for (const s of state.data.schedules) {
    const guid = tripGuid(s.regionGuid, tomorrow)
    trips.set(guid, {
      guid, number: `ЦБ-${guid.slice(0, 6).toUpperCase()}`, status: 'forming',
      plannedStart: `${tomorrow}T${s.arrivalFrom}:00.000+03:00`, plannedEnd: null, actualStart: null, actualEnd: null,
      vehicle: '', regionGuids: [s.regionGuid], orders: [], changedAt: `${dayStart}T00:00:00.000Z`, deleted: false,
    })
  }
  for (const o of state.orders.values()) {
    if (o.test) continue
    const at = orderStatusAt(o, now)
    if (!['assembled', 'shipped', 'delivered'].includes(at.status)) continue
    const region = state.data.clients.find(c => c.guid === o.clientGuid)?.region
    if (!region) continue
    const date = new Date(o.createdAt + SHIPPED_AFTER_SEC * 1000).toISOString().slice(0, 10)
    const guid = tripGuid(region.guid, date)
    const status = at.status === 'assembled' ? 'loading' : at.status === 'shipped' ? 'sent' : 'closed'
    const changedAt = new Date(at.changedAt).toISOString()
    const trip = trips.get(guid) ?? {
      guid, number: `ЦБ-${guid.slice(0, 6).toUpperCase()}`, status, plannedStart: new Date(o.createdAt + SHIPPED_AFTER_SEC * 1000).toISOString(),
      plannedEnd: null, actualStart: null, actualEnd: null, vehicle: 'АМ 3634-1 ГАЗ-А31R32', regionGuids: [region.guid], orders: [], changedAt, deleted: false,
    }
    trip.vehicle ||= 'АМ 3634-1 ГАЗ-А31R32'
    if (status === 'sent' || status === 'closed') trip.actualStart ??= new Date(o.createdAt + SHIPPED_AFTER_SEC * 1000).toISOString()
    if (status === 'closed') trip.actualEnd ??= changedAt
    // Статус рейса — по самому «отстающему» заказу: рейс закрыт, когда доставлено всё.
    const rank = { forming: 0, loading: 1, sent: 2, closed: 3 } as const
    if (trip.orders.length === 0 || rank[status] < rank[trip.status]) trip.status = status
    if (changedAt > trip.changedAt) trip.changedAt = changedAt
    trip.orders.push({ orderGuid: o.orderGuid, number: o.number, clientGuid: o.clientGuid })
    trips.set(guid, trip)
  }
  return [...trips.values()]
}

/** Рейс заказа — тот же расчёт, что в `mockTrips`. */
function orderTripGuid(state: MockState, o: MockOrder, status: OrderStatusT): string | null {
  if (!['assembled', 'shipped', 'delivered'].includes(status)) return null
  const region = state.data.clients.find(c => c.guid === o.clientGuid)?.region
  return region ? tripGuid(region.guid, new Date(o.createdAt + SHIPPED_AFTER_SEC * 1000).toISOString().slice(0, 10)) : null
}

/** Между запросами остатков меняются несколько позиций — клиенту есть что синхронизировать. */
function moveStock(state: MockState, now: number) {
  state.stockTicks++
  const keys = [...state.data.stock.keys()]
  for (let i = 0; i < 5; i++) {
    const key = keys[Math.floor(state.rand() * keys.length)]!
    const delta = Math.floor(state.rand() * 41) - 20
    state.data.stock.set(key, Math.max(0, state.data.stock.get(key)! + delta))
    state.stockChangedAt.set(key, now)
  }
}

/** Прайс мока: «вид цен × товар», цена — базовая × коэффициент вида цен. */
function priceRows(state: MockState): PriceT[] {
  const rows: PriceT[] = []
  for (const pt of state.data.priceTypes) {
    for (const item of state.data.items) {
      const base = state.data.basePrice.get(item.guid)
      if (base === undefined) continue
      rows.push({ priceTypeGuid: pt.guid, itemGuid: item.guid, price: round2(base * pt.coefficient), currency: 'BYN', vatRate: 20, changedAt: state.priceChangedAt.get(item.guid) ?? item.changedAt, deleted: false })
    }
  }
  return rows
}

/** Что 1С скажет о строках заказа: цена по прайсу договора, резерв — сколько есть на складах. */
function orderFacts(state: MockState, priceTypeGuid: string, items: { itemGuid: string, qty: number, price: number }[]): OrderLineFactT[] {
  const pt = state.data.priceTypes.find(p => p.guid === priceTypeGuid)
  return items.map((line) => {
    const guid = line.itemGuid.toLowerCase()
    const base = state.data.basePrice.get(guid)
    let free = 0
    for (const w of state.data.warehouses) free += state.data.stock.get(`${guid}|${w.guid}`) ?? 0
    return { itemGuid: guid, price: base !== undefined && pt ? round2(base * pt.coefficient) : line.price, reserved: Math.min(line.qty, free) }
  })
}

function newClient(state: MockState, name: string | undefined, now: number): ClientT {
  const { data } = state
  const contract = {
    guid: guidFrom(state.rand),
    number: `ОПТ-${String(data.contracts.length + 1).padStart(3, '0')}/2026`,
    date: new Date(now).toISOString().slice(0, 10),
    priceTypeGuid: data.priceTypes[0]!.guid,
    paymentDelayDays: 14,
    creditLimit: 5000,
    debt: 0,
    currency: 'BYN',
  }
  data.contracts.push(contract)
  const client: ClientT = {
    guid: guidFrom(state.rand),
    name: name?.trim() || `ООО «Новый клиент ${data.clients.length + 1}»`,
    unp: String(190000000 + Math.floor(state.rand() * 9_999_999)),
    address: 'г. Минск, ул. Новая, 1',
    city: 'Минск',
    region: data.clients.find(c => c.city === 'Минск')?.region ?? null,
    shipmentBlocked: false,
    managerEmail: 'manager1@example.by',
    contract,
    deliveryAddresses: [{ guid: guidFrom(state.rand), city: 'Минск', address: 'г. Минск, ул. Новая, 1' }],
    changedAt: new Date(now).toISOString(),
    deleted: false,
  }
  data.clients.push(client)
  return client
}

/** Обработка запроса к моку. `now` — мс эпохи. */
export function handleMockRequest(state: MockState, req: MockRequest, now: number): MockResponse {
  const { mode } = state
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.authorization ?? '')?.[1] ?? ''
  const a = Buffer.from(bearer)
  const b = Buffer.from(state.token)
  if (!state.token || a.length !== b.length || !timingSafeEqual(a, b)) return error('unauthorized', 'Bearer token required')

  const method = req.method.toUpperCase()
  const path = req.path.replace(/\/+$/, '') || '/'

  // Управление моком — не часть контракта 1С, поэтому до режимов отказа: им и включают отказы.
  if (path.startsWith('/_admin/')) return handleAdmin(state, method, path, req.body, now)

  if (mode.failNext > 0) {
    mode.failNext--
    return error('unavailable', 'Mock: forced failure', mode.delayMs)
  }
  if (mode.failRate > 0 && state.rand() < mode.failRate) return error('unavailable', 'Mock: random failure', mode.delayMs)

  const ok = (body: unknown, status = 200): MockResponse => ({ status, body, delayMs: mode.delayMs })
  const list = () => {
    const parsed = ListQuery.safeParse(req.query)
    return parsed.success ? parsed.data : null
  }
  // changedSince включает границу (docs/onec-contract.md): строгое «>» теряло бы записи того же момента.
  const since = (changedSince: string | undefined) => changedSince ? Date.parse(changedSince) : -Infinity

  if (method === 'GET' && path === '/clients') {
    const q = list()
    if (!q) return error('validation', 'Bad list parameters')
    const rows = byChange(state.data.clients.filter(c => Date.parse(c.changedAt) >= since(q.changedSince)), c => c.changedAt, c => c.guid)
    return ok(paginate(rows, q.page, q.pageSize))
  }

  if (method === 'GET' && path === '/catalog') {
    const q = list()
    if (!q) return error('validation', 'Bad list parameters')
    const rows = byChange(state.data.items.filter(i => Date.parse(i.changedAt) >= since(q.changedSince)), i => i.changedAt, i => i.guid)
    const pageData = paginate(rows, q.page, q.pageSize)
    // Разделы — целиком на первой странице: дерево небольшое и нужно до товаров.
    return ok({ sections: q.page === 1 ? state.data.sections : [], ...pageData })
  }

  const imageMatch = /^\/image\/([^/]+)$/.exec(path)
  if (method === 'GET' && imageMatch) {
    const id = decodeURIComponent(imageMatch[1]!)
    const image = state.data.images.get(id)
    return image ? ok({ id, hash: image.hash, contentType: 'image/jpeg', data: image.data }) : error('not_found', 'Image not found')
  }

  if (method === 'GET' && path === '/prices') {
    const q = list()
    if (!q) return error('validation', 'Bad list parameters')
    const rows = byChange(priceRows(state).filter(r => Date.parse(r.changedAt) >= since(q.changedSince)), r => r.changedAt, r => `${r.priceTypeGuid}|${r.itemGuid}`)
    return ok(paginate(rows, q.page, q.pageSize))
  }

  if (method === 'GET' && path === '/stock') {
    const q = list()
    if (!q) return error('validation', 'Bad list parameters')
    if (q.page === 1) moveStock(state, now)
    const rows: StockT[] = []
    for (const [key, available] of state.data.stock) {
      const changedAt = state.stockChangedAt.get(key)!
      if (changedAt < since(q.changedSince)) continue
      const [itemGuid, warehouseGuid] = key.split('|') as [string, string]
      const warehouse = state.data.warehouses.find(w => w.guid === warehouseGuid)!
      rows.push({ itemGuid, warehouseGuid, warehouseName: warehouse.name, available, changedAt: new Date(changedAt).toISOString() })
    }
    return ok(paginate(byChange(rows, r => r.changedAt, r => `${r.itemGuid}|${r.warehouseGuid}`), q.page, q.pageSize))
  }

  if (method === 'POST' && path === '/order') {
    const parsed = OrderRequest.safeParse(req.body)
    if (!parsed.success) return error('validation', 'Bad order request')
    const existing = state.ordersByExternalId.get(parsed.data.externalId)
    if (existing && existing.clientGuid !== parsed.data.clientGuid.toLowerCase()) {
      // Чужой externalId: молча вернуть чужой заказ значило бы показать его другому клиенту.
      return error('conflict', 'externalId already used by another client')
    }
    const client = state.data.clients.find(c => c.guid.toLowerCase() === parsed.data.clientGuid.toLowerCase() && !c.deleted)
    if (!client) return error('not_found', 'Client not found')
    if (client.contract?.guid !== parsed.data.contractGuid.toLowerCase() || !client.deliveryAddresses.some(a => a.guid === parsed.data.deliveryAddressGuid.toLowerCase())) {
      return error('validation', 'Contract or delivery address does not belong to the client')
    }
    const order = existing ?? (() => {
      const created: MockOrder = {
        orderGuid: guidFrom(state.rand),
        externalId: parsed.data.externalId,
        clientGuid: client.guid,
        number: parsed.data.test ? `ТЕСТ-${parsed.data.externalId}` : `ЗК-${String(state.orders.size + 1).padStart(5, '0')}`,
        test: parsed.data.test === true,
        createdAt: now,
        cancelledAt: null,
        lines: orderFacts(state, client.contract!.priceTypeGuid, parsed.data.items),
      }
      state.orders.set(created.orderGuid, created)
      state.ordersByExternalId.set(created.externalId, created)
      return created
    })()
    // Повтор с тем же externalId — тот же заказ и 200, первое создание — 201.
    return ok({ orderGuid: order.orderGuid, number: order.number, status: orderStatusAt(order, now).status, items: order.lines }, existing ? 200 : 201)
  }

  if (method === 'GET' && path === '/orders/status') {
    const q = list()
    if (!q) return error('validation', 'Bad list parameters')
    const rows = [...state.orders.values()].filter(o => !o.test).map((o) => {
      const { status, changedAt } = orderStatusAt(o, now)
      return {
        orderGuid: o.orderGuid,
        externalId: o.externalId,
        number: o.number,
        status,
        shipmentDate: status === 'shipped' || status === 'delivered' ? new Date(o.createdAt + SHIPPED_AFTER_SEC * 1000).toISOString().slice(0, 10) : null,
        tripGuid: orderTripGuid(state, o, status),
        changedAt: new Date(changedAt).toISOString(),
      }
    }).filter(r => Date.parse(r.changedAt) >= since(q.changedSince))
    return ok(paginate(byChange(rows, r => r.changedAt, r => r.orderGuid), q.page, q.pageSize))
  }

  if (method === 'GET' && path === '/delivery-schedule') {
    return ok({ items: state.data.schedules })
  }

  if (method === 'GET' && path === '/trips') {
    const q = list()
    if (!q) return error('validation', 'Bad list parameters')
    const rows = mockTrips(state, now).filter(t => Date.parse(t.changedAt) >= since(q.changedSince))
    return ok(paginate(byChange(rows, t => t.changedAt, t => t.guid), q.page, q.pageSize))
  }

  return error('not_found', `No route ${method} ${path}`)
}

function handleAdmin(state: MockState, method: string, path: string, body: unknown, now: number): MockResponse {
  if (method !== 'POST') return error('not_found', 'Admin routes are POST')
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

  if (path === '/_admin/reset') {
    const fresh = createMockState(state.token, typeof input.seed === 'number' ? input.seed : state.seed, state.demoClients)
    Object.assign(state, fresh)
    return { status: 200, body: { ok: true, seed: state.seed }, delayMs: 0 }
  }
  if (path === '/_admin/client') {
    return { status: 201, body: newClient(state, typeof input.name === 'string' ? input.name : undefined, now), delayMs: 0 }
  }
  if (path === '/_admin/mode') {
    const num = (v: unknown, max: number) => typeof v === 'number' && v >= 0 && v <= max ? v : undefined
    state.mode = {
      delayMs: num(input.delayMs, 30_000) ?? state.mode.delayMs,
      failRate: num(input.failRate, 1) ?? state.mode.failRate,
      failNext: Number.isInteger(input.failNext) ? num(input.failNext, 1000) ?? state.mode.failNext : state.mode.failNext,
    }
    return { status: 200, body: state.mode, delayMs: 0 }
  }
  // «Как будто в 1С поменяли» — для проверки синхронизации на моке (docs/MONITORING.md).
  if (path === '/_admin/price') {
    const count = Number.isInteger(input.count) && (input.count as number) > 0 ? Math.min(input.count as number, 50) : 3
    const factor = typeof input.factor === 'number' && input.factor > 0 && input.factor < 10 ? input.factor : 1.05
    const changed = state.data.items.slice(0, count).map((item) => {
      const was = state.data.basePrice.get(item.guid)!
      state.data.basePrice.set(item.guid, round2(was * factor))
      state.priceChangedAt.set(item.guid, new Date(now).toISOString())
      return { itemGuid: item.guid, name: item.name, base: { was, now: state.data.basePrice.get(item.guid) } }
    })
    return { status: 200, body: { changed }, delayMs: 0 }
  }
  if (path === '/_admin/debt') {
    const client = state.data.clients.find(c => c.contract && !c.deleted)
    if (!client) return error('not_found', 'No client with contract')
    client.contract = { ...client.contract!, debt: round2(client.contract!.debt + (typeof input.add === 'number' ? input.add : 100)) }
    client.changedAt = new Date(now).toISOString()
    return { status: 200, body: { client: client.name, debt: client.contract.debt }, delayMs: 0 }
  }
  if (path === '/_admin/item') {
    const item = state.data.items[typeof input.index === 'number' ? input.index : 1]
    if (!item) return error('not_found', 'No item')
    item.name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : `${item.name.replace(/ \(изм\. [\d:]+\)$/, '')} (изм. ${new Date(now).toISOString().slice(11, 16)})`
    item.changedAt = new Date(now).toISOString()
    return { status: 200, body: { item: item.name }, delayMs: 0 }
  }
  if (path === '/_admin/cancel') {
    const order = state.orders.get(String(input.orderGuid ?? ''))
    if (!order) return error('not_found', 'Order not found')
    order.cancelledAt = now
    return { status: 200, body: { ok: true }, delayMs: 0 }
  }
  return error('not_found', `No admin route ${path}`)
}
