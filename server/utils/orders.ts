/**
 * Корзина и заявка ЛК (docs/spec.md §1, шаги 5–7). Чистые функции с внедряемыми зависимостями:
 * проверяются без сервера (tests/orders.test.ts).
 *
 * - Цена, название и кратность берутся с сервера: из браузера — только GUID товара и количество.
 * - Заявка уходит, только если у каждой строки есть цена договора: сделка без цены — работа
 *   менеджеру вслепую, а клиенту — неверный итог.
 * - `requestId` (UUID из браузера) делает отправку идемпотентной: повтор после обрыва связи
 *   возвращает ту же заявку, а не создаёт вторую сделку.
 */
import type { DatabaseSync } from 'node:sqlite'
import { addressLine, CART_LINES_MAX, COMMENT_MAX, humanDateTime, isValidQty, lineTotal, neutralizeBb, normalizeQty, type CartLineInput } from '../../shared/cart'
import type { CatalogStore } from './catalog'
import type { ClientPricing, PriceSource } from './catalogView'
import { GUID_RE } from './catalogView'
import type { ClientStore, DeliveryAddress } from './clients'
import type { B24Orders, Trip } from '../services/b24Orders'

export type LineProblem = 'not_found' | 'no_price' | 'bad_qty'

export interface QuoteLine {
  guid: string
  sku: string
  name: string
  unit: string
  packQty: number
  minQty: number
  available: number
  qty: number
  /** Ближайшее допустимое количество — экран предлагает его, если введено не кратное. */
  suggestedQty: number
  price: number | null
  vatRate: number
  currency: string | null
  total: number
  problem: LineProblem | null
}

export interface Quote {
  lines: QuoteLine[]
  total: number
  currency: string | null
  priceStatus: ClientPricing['status']
  ok: boolean
}

/** Разбор корзины из тела запроса: мусор отбрасывается, повторы одного товара складываются. */
export function parseCartLines(body: unknown): CartLineInput[] {
  const raw = (body as { items?: unknown })?.items
  if (!Array.isArray(raw)) return []
  const byGuid = new Map<string, number>()
  for (const r of raw.slice(0, CART_LINES_MAX)) {
    const guid = typeof r?.guid === 'string' ? r.guid.toLowerCase() : ''
    const qty = Number(r?.qty)
    if (!GUID_RE.test(guid) || !Number.isFinite(qty) || qty <= 0 || qty > 1e6) continue
    byGuid.set(guid, (byGuid.get(guid) ?? 0) + qty)
  }
  return [...byGuid].map(([guid, qty]) => ({ guid, qty }))
}

export async function quoteCart(lines: CartLineInput[], store: CatalogStore, pricing: ClientPricing, prices: PriceSource): Promise<Quote> {
  const items = lines.map(l => ({ input: l, item: store.item(l.guid) }))
  const known = items.filter(i => i.item).map(i => i.item!.guid)
  let priceMap = new Map<string, { price: number, currency: string, vatRate: number }>()
  let priceStatus: Quote['priceStatus'] = pricing.status
  if (pricing.status === 'ok' && known.length) {
    try {
      priceMap = await prices(pricing.clientGuid, known) as never
    }
    catch {
      priceStatus = 'unavailable'
    }
  }
  const out: QuoteLine[] = items.map(({ input, item }) => {
    if (!item) {
      return { guid: input.guid, sku: '', name: 'Товар больше не продаётся', unit: '', packQty: 1, minQty: 1, available: 0, qty: input.qty, suggestedQty: input.qty, price: null, vatRate: 0, currency: null, total: 0, problem: 'not_found' }
    }
    const p = priceMap.get(item.guid)
    const valid = isValidQty(input.qty, item.packQty, item.minQty)
    return {
      guid: item.guid, sku: item.sku, name: item.name, unit: item.unit, packQty: item.packQty, minQty: item.minQty,
      available: item.available, qty: input.qty, suggestedQty: normalizeQty(input.qty, item.packQty, item.minQty),
      price: p?.price ?? null, vatRate: p?.vatRate ?? 0, currency: p?.currency ?? null,
      total: p ? lineTotal(p.price, input.qty) : 0,
      problem: !valid ? 'bad_qty' : p ? null : 'no_price',
    }
  })
  const currencies = new Set(out.filter(l => l.currency).map(l => l.currency!))
  const total = Math.round(out.reduce((s, l) => s + l.total, 0) * 100) / 100
  return {
    lines: out,
    total,
    // Валюта договора одна; две валюты в одной заявке — не складываем, а не пускаем дальше.
    currency: currencies.size === 1 ? [...currencies][0]! : null,
    priceStatus,
    ok: out.length > 0 && out.every(l => !l.problem) && currencies.size === 1 && priceStatus === 'ok',
  }
}

/** Заявки компании в базе ЛК: «Мои заявки» читаются отсюда, по компании из сессии. */
export function createOrderStore(db: DatabaseSync) {
  const insert = db.prepare(`INSERT INTO order_request (request_id, company_id, contact_id, client_guid, contract_guid, address_guid,
      address_text, delivery_at, items, total, currency, comment, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT (request_id) DO NOTHING`)
  const byRequest = db.prepare('SELECT * FROM order_request WHERE request_id = ?')
  const setDeal = db.prepare(`UPDATE order_request SET deal_id = ?, status = 'sent', error = NULL, updated_at = ? WHERE id = ?`)
  const setError = db.prepare('UPDATE order_request SET error = ?, updated_at = ? WHERE id = ?')
  const list = db.prepare(`SELECT id, created_at AS createdAt, status, delivery_at AS deliveryAt, address_text AS address,
      total, currency, deal_id AS dealId, onec_number AS onecNumber, shipment_date AS shipmentDate, items
    FROM order_request WHERE company_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
  return {
    /** Вставляет черновик или возвращает уже существующий по requestId. */
    begin(row: OrderRow) {
      insert.run(row.requestId, row.companyId, row.contactId, row.clientGuid, row.contractGuid, row.addressGuid, row.addressText,
        row.deliveryAt, JSON.stringify(row.items), row.total, row.currency, row.comment, row.now, row.now)
      return byRequest.get(row.requestId) as { id: number, company_id: number, deal_id: number | null, status: string }
    },
    sent(id: number, dealId: number, now: string) { setDeal.run(dealId, now, id) },
    failed(id: number, error: string, now: string) { setError.run(error.slice(0, 500), now, id) },
    list(companyId: number, limit = 20, offset = 0) {
      return (list.all(companyId, Math.min(Math.max(limit, 1), 50), Math.max(offset, 0)) as unknown as (OrderListRow & { items: string })[])
        .map(r => ({ ...r, items: JSON.parse(r.items) as OrderItem[] }))
    },
  }
}

export interface OrderItem { guid: string, sku: string, name: string, unit: string, qty: number, price: number, vatRate: number }
export interface OrderRow {
  requestId: string
  companyId: number
  contactId: number
  clientGuid: string
  contractGuid: string
  addressGuid: string
  addressText: string
  deliveryAt: string | null
  items: OrderItem[]
  total: number
  currency: string
  comment: string
  now: string
}
export interface OrderListRow {
  id: number
  createdAt: string
  status: string
  deliveryAt: string | null
  address: string
  total: number
  currency: string
  dealId: number | null
  onecNumber: string | null
  shipmentDate: string | null
}
export type OrderStore = ReturnType<typeof createOrderStore>

export interface SubmitInput { requestId: string, lines: CartLineInput[], addressGuid: string, comment: string }
export interface SubmitDeps {
  store: CatalogStore
  clients: ClientStore
  orders: OrderStore
  b24: Pick<B24Orders, 'createDeal' | 'nearestTrip'>
  prices: PriceSource
  now?: () => Date
}

export type SubmitResult =
  | { ok: true, orderId: number, dealId: number, deliveryAt: string | null }
  | { ok: false, status: number, error: 'bad_request' | 'no_contract' | 'bad_address' | 'cart_invalid' | 'crm_unavailable', quote?: Quote }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function submitOrder(
  session: { companyId: number, contactId: number },
  pricing: ClientPricing,
  input: SubmitInput,
  deps: SubmitDeps,
): Promise<SubmitResult> {
  const now = deps.now?.() ?? new Date()
  if (!UUID_RE.test(input.requestId) || input.lines.length === 0 || input.comment.length > COMMENT_MAX) return { ok: false, status: 400, error: 'bad_request' }
  if (pricing.status === 'no-contract') return { ok: false, status: 409, error: 'no_contract' }
  if (pricing.status !== 'ok') return { ok: false, status: 503, error: 'crm_unavailable' }
  const client = deps.clients.get(pricing.clientGuid)
  if (!client?.contractGuid) return { ok: false, status: 409, error: 'no_contract' }
  const address: DeliveryAddress | undefined = client.addresses.find(a => a.guid === input.addressGuid.toLowerCase())
  if (!address) return { ok: false, status: 400, error: 'bad_address' }

  const quote = await quoteCart(input.lines, deps.store, pricing, deps.prices)
  if (!quote.ok) return { ok: false, status: quote.priceStatus === 'unavailable' ? 503 : 422, error: 'cart_invalid', quote }

  // Рейс — подсказка клиенту и менеджеру, а не условие: сбой «Рейсов» заявку не останавливает.
  let trip: Trip | null = null
  try {
    trip = await deps.b24.nearestTrip(address.city, now)
  }
  catch (e) {
    console.error(`[orders] trip lookup: ${(e as Error).name}`)
  }

  const items: OrderItem[] = quote.lines.map(l => ({ guid: l.guid, sku: l.sku, name: l.name, unit: l.unit, qty: l.qty, price: l.price!, vatRate: l.vatRate }))
  const comment = input.comment.trim()
  const row = deps.orders.begin({
    requestId: input.requestId, companyId: session.companyId, contactId: session.contactId, clientGuid: client.guid,
    contractGuid: client.contractGuid, addressGuid: address.guid, addressText: addressLine(address.city, address.address),
    deliveryAt: trip?.departureAt ?? null, items, total: quote.total, currency: quote.currency!, comment, now: now.toISOString(),
  })
  // Чужой requestId (другая компания) не открывает чужую заявку.
  if (row.company_id !== session.companyId) return { ok: false, status: 400, error: 'bad_request' }
  if (row.deal_id) return { ok: true, orderId: row.id, dealId: row.deal_id, deliveryAt: trip?.departureAt ?? null }

  const lines = [
    `Заявка из личного кабинета №${row.id}.`,
    `Адрес доставки: ${neutralizeBb(addressLine(address.city, address.address))}`,
    trip ? `Ближайший рейс: ${humanDateTime(trip.departureAt)}` : 'Ближайший рейс не найден — уточните дату с клиентом.',
    comment ? `Комментарий клиента: ${neutralizeBb(comment)}` : '',
  ].filter(Boolean)
  try {
    const dealId = await deps.b24.createDeal({
      requestId: input.requestId,
      companyId: session.companyId,
      contactId: session.contactId,
      title: `Заявка ЛК №${row.id}: ${client.name}`,
      comments: lines.join('\n'),
      total: quote.total,
      currency: quote.currency!,
      rows: items.map(i => ({ name: `${i.name} (${i.sku})`, price: i.price, qty: i.qty, unit: i.unit, vatRate: i.vatRate })),
    })
    deps.orders.sent(row.id, dealId, now.toISOString())
    return { ok: true, orderId: row.id, dealId, deliveryAt: trip?.departureAt ?? null }
  }
  catch (e) {
    // Черновик остаётся: повтор с тем же requestId дошлёт ту же заявку, а не создаст новую.
    deps.orders.failed(row.id, (e as Error).message, now.toISOString())
    console.error(`[orders] deal: ${(e as Error).message}`)
    return { ok: false, status: 503, error: 'crm_unavailable' }
  }
}
