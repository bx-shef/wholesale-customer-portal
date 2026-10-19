/**
 * Корзина и заявка ЛК (docs/spec.md §1, шаги 5–7). Чистые функции с внедряемыми зависимостями:
 * проверяются без сервера (tests/orders.test.ts).
 *
 * - Цена, название и кратность берутся с сервера: из браузера — только GUID товара и количество.
 * - Заявка уходит, только если у каждой строки есть цена договора и валюта одна.
 * - `requestId` (UUID из браузера) делает отправку идемпотентной. Строка заявки — источник правды:
 *   сделка всегда собирается из сохранённой строки, а не из пересчёта на повторе, поэтому база,
 *   CRM и ответ клиенту не расходятся. Изменилась корзина при том же requestId — пока сделки нет,
 *   строка обновляется; после — 409, клиент начинает новую заявку.
 * - Отправку в CRM захватывает одна попытка (`pending` → `sending`): двойной клик и вторая вкладка
 *   не создают двух сделок. Захват протухает через SENDING_STALE_MS — упавший процесс не держит
 *   заявку вечно; на этот случай страхует поиск сделки по ORIGIN_ID.
 */
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { PriceT } from '../../shared/onec/schemas'
import { addressLine, CART_LINES_MAX, COMMENT_MAX, isValidQty, lineTotal, neutralizeBb, normalizeQty, roundQty, type CartLineInput } from '../../shared/cart'
import { formatCutoff, formatSlot, nextDelivery, type DeliverySlot, type TripSchedule } from '../../shared/delivery'
import type { CatalogStore } from './catalog'
import type { ClientPricing, PriceSource } from './catalogView'
import { GUID_RE } from './catalogView'
import type { ClientStore } from './clients'
import type { B24Orders } from '../services/b24Orders'

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

const QTY_MAX = 1e6

/** Разбор корзины из тела запроса: мусор отбрасывается, повторы одного товара складываются. */
export function parseCartLines(body: unknown): CartLineInput[] {
  const raw = (body as { items?: unknown })?.items
  if (!Array.isArray(raw)) return []
  const byGuid = new Map<string, number>()
  for (const r of raw.slice(0, CART_LINES_MAX)) {
    const guid = typeof r?.guid === 'string' ? r.guid.toLowerCase() : ''
    const qty = Number(r?.qty)
    if (!GUID_RE.test(guid) || !Number.isFinite(qty) || qty <= 0 || qty > QTY_MAX) continue
    byGuid.set(guid, roundQty((byGuid.get(guid) ?? 0) + qty))
  }
  return [...byGuid].map(([guid, qty]) => ({ guid, qty }))
}

export async function quoteCart(lines: CartLineInput[], store: CatalogStore, pricing: ClientPricing, prices: PriceSource): Promise<Quote> {
  const items = lines.map(l => ({ input: l, item: store.item(l.guid) }))
  const known = items.filter(i => i.item).map(i => i.item!.guid)
  let priceMap = new Map<string, PriceT>()
  let priceStatus: Quote['priceStatus'] = pricing.status
  if (pricing.status === 'ok' && known.length) {
    try {
      priceMap = await prices(pricing.clientGuid, known)
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
  // Итог — сумма уже округлённых строк: так же считает и сделка (цена × количество по строкам).
  const total = Math.round(out.reduce((s, l) => s + l.total * 100, 0)) / 100
  return {
    lines: out,
    total,
    // Валюта договора одна; две валюты в одной заявке — не складываем, а не пускаем дальше.
    currency: currencies.size === 1 ? [...currencies][0]! : null,
    priceStatus,
    ok: out.length > 0 && out.every(l => !l.problem) && currencies.size === 1 && priceStatus === 'ok',
  }
}

export interface OrderItem { guid: string, sku: string, name: string, unit: string, qty: number, price: number, vatRate: number }

export interface OrderDraft {
  requestId: string
  companyId: number
  contactId: number
  clientGuid: string
  contractGuid: string
  addressGuid: string
  addressText: string
  slot: DeliverySlot | null
  items: OrderItem[]
  total: number
  currency: string
  comment: string
}

export interface OrderRowDb {
  id: number
  request_id: string
  company_id: number
  contact_id: number
  client_guid: string
  contract_guid: string
  address_guid: string
  address_text: string
  delivery_from: string | null
  delivery_to: string | null
  payload_hash: string
  items: string
  total: number
  currency: string
  comment: string
  deal_id: number | null
  status: string
  updated_at: string
  sending_at: string | null
  onec_order_guid: string | null
  onec_number: string | null
  shipment_date: string | null
  crm_status: string | null
  checked_at: string | null
  attempts: number
}

export interface OrderListRow {
  id: number
  createdAt: string
  status: string
  deliveryFrom: string | null
  deliveryTo: string | null
  address: string
  total: number
  currency: string
  onecNumber: string | null
  shipmentDate: string | null
  /** Задание на перевозку 1С, в которое попал заказ. */
  tripGuid: string | null
  items: OrderItem[]
}

export const resendPauseMs = (attempts: number) => Math.min(2 ** Math.max(attempts - 1, 0), 60) * 60_000

/** Захват отправки протухает: упавшая попытка не держит заявку дольше этого. */
export const SENDING_STALE_MS = 2 * 60_000

/**
 * Отпечаток того, что выбрал клиент: адрес, комментарий, товары и количество. Цены в него не входят:
 * повтор после смены цены в 1С — тот же заказ клиента, и в сделку уходят цены, сохранённые в строке.
 */
export function payloadHash(d: Pick<OrderDraft, 'addressGuid' | 'items' | 'comment'>): string {
  const key = JSON.stringify([d.addressGuid, d.comment, d.items.map(i => [i.guid, i.qty]).sort()])
  return createHash('sha256').update(key).digest('hex')
}

/** Заявки компании в базе ЛК: «Мои заявки» читаются отсюда, по компании из сессии. */
export function createOrderStore(db: DatabaseSync) {
  const insert = db.prepare(`INSERT INTO order_request (request_id, company_id, contact_id, client_guid, contract_guid, address_guid,
      address_text, delivery_from, delivery_to, payload_hash, items, total, currency, comment, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT (request_id) DO NOTHING`)
  const byRequest = db.prepare('SELECT * FROM order_request WHERE request_id = ?')
  const replace = db.prepare(`UPDATE order_request SET address_guid = ?, address_text = ?, delivery_from = ?, delivery_to = ?,
      payload_hash = ?, items = ?, total = ?, currency = ?, comment = ?, updated_at = ?
    WHERE id = ? AND status = 'pending' AND deal_id IS NULL`)
  const claim = db.prepare(`UPDATE order_request SET status = 'sending', sending_at = ?, updated_at = ?
    WHERE id = ? AND deal_id IS NULL AND (status = 'pending' OR (status = 'sending' AND sending_at < ?))`)
  const setDeal = db.prepare(`UPDATE order_request SET deal_id = ?, status = 'sent', sending_at = NULL, error = NULL, updated_at = ? WHERE id = ?`)
  const setError = db.prepare(`UPDATE order_request SET status = 'pending', sending_at = NULL, error = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?`)
  const toResend = db.prepare(`SELECT * FROM order_request WHERE deal_id IS NULL
    AND ((status = 'pending' AND updated_at < ?) OR (status = 'sending' AND sending_at < ?)) ORDER BY updated_at LIMIT 100`)
  // По кругу: давно не проверенные — первыми, чтобы «молчащие» сделки не занимали очередь навсегда.
  const awaiting = db.prepare(`SELECT * FROM order_request WHERE deal_id IS NOT NULL AND status = 'sent'
    ORDER BY checked_at IS NOT NULL, checked_at, id LIMIT ?`)
  const setChecked = db.prepare('UPDATE order_request SET checked_at = ? WHERE id = ?')
  const crmBehind = db.prepare(`SELECT * FROM order_request WHERE deal_id IS NOT NULL AND onec_order_guid IS NOT NULL
    AND (crm_status IS NULL OR crm_status <> status) ORDER BY updated_at LIMIT ?`)
  const setCrm = db.prepare('UPDATE order_request SET crm_status = ? WHERE id = ?')
  const byId = db.prepare('SELECT * FROM order_request WHERE id = ?')
  const setStatus = db.prepare('UPDATE order_request SET status = ?, error = NULL, updated_at = ? WHERE id = ?')
  const setOnec = db.prepare(`UPDATE order_request SET onec_order_guid = ?, onec_number = ?, status = ?, delivery_from = ?,
      delivery_to = ?, error = NULL, updated_at = ? WHERE id = ? AND onec_order_guid IS NULL`)
  const setNote = db.prepare('UPDATE order_request SET error = ?, updated_at = ? WHERE id = ?')
  const byOnec = db.prepare('SELECT * FROM order_request WHERE onec_order_guid = ?')
  const applyOnec = db.prepare('UPDATE order_request SET status = ?, shipment_date = ?, onec_number = ?, updated_at = ? WHERE id = ?')
  const setTrip = db.prepare('UPDATE order_request SET trip_guid = ? WHERE id = ? AND trip_guid IS NOT ?')
  const list = db.prepare(`SELECT id, created_at AS createdAt, status, delivery_from AS deliveryFrom, delivery_to AS deliveryTo,
      address_text AS address, total, currency, onec_number AS onecNumber, shipment_date AS shipmentDate, trip_guid AS tripGuid, items
    FROM order_request WHERE company_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)

  return {
    /** Черновик или уже существующая строка с тем же requestId. */
    begin(d: OrderDraft, hash: string, now: string): OrderRowDb {
      insert.run(d.requestId, d.companyId, d.contactId, d.clientGuid, d.contractGuid, d.addressGuid, d.addressText,
        d.slot?.arrivalFrom ?? null, d.slot?.arrivalTo ?? null, hash, JSON.stringify(d.items), d.total, d.currency, d.comment, now, now)
      return byRequest.get(d.requestId) as unknown as OrderRowDb
    },
    /** Правка ещё не отправленной заявки: true — обновлено. */
    replace(id: number, d: OrderDraft, hash: string, now: string): boolean {
      return Number(replace.run(d.addressGuid, d.addressText, d.slot?.arrivalFrom ?? null, d.slot?.arrivalTo ?? null, hash,
        JSON.stringify(d.items), d.total, d.currency, d.comment, now, id).changes) === 1
    },
    /** Захватить отправку: true — эта попытка единственная. */
    claim(id: number, now: Date): boolean {
      const iso = now.toISOString()
      return Number(claim.run(iso, iso, id, new Date(now.getTime() - SENDING_STALE_MS).toISOString()).changes) === 1
    },
    get(requestId: string): OrderRowDb | undefined {
      return byRequest.get(requestId) as unknown as OrderRowDb | undefined
    },
    sent(id: number, dealId: number, now: string) { setDeal.run(dealId, now, id) },
    /** Застрявшие без сделки: CRM упала, а клиент закрыл вкладку. */
    /** Пауза между попытками растёт: 1, 2, 4 … 60 минут — долгий простой CRM не долбится каждые 2 минуты. */
    toResend(now: Date, limit = 20): OrderRowDb[] {
      const old = new Date(now.getTime() - 60_000).toISOString()
      const stale = new Date(now.getTime() - SENDING_STALE_MS).toISOString()
      return (toResend.all(old, stale) as unknown as OrderRowDb[])
        .filter(r => r.status === 'sending' || Date.parse(r.updated_at) <= now.getTime() - resendPauseMs(r.attempts))
        .slice(0, limit)
    },
    /** Сделка есть, заказа в 1С ещё нет — ждём подтверждения менеджера. */
    awaitingConfirmation(limit = 50): OrderRowDb[] {
      return awaiting.all(limit) as unknown as OrderRowDb[]
    },
    checked(id: number, now: string) { setChecked.run(now, id) },
    /** Статус из 1С ещё не сообщён в сделку (сбой CRM прошлых запусков не теряется). */
    crmBehind(limit = 50): OrderRowDb[] {
      return crmBehind.all(limit) as unknown as OrderRowDb[]
    },
    crmReported(id: number, status: string) { setCrm.run(status, id) },
    byId(id: number): OrderRowDb | undefined { return byId.get(id) as unknown as OrderRowDb | undefined },
    setStatus(id: number, status: string, now: string) { setStatus.run(status, now, id) },
    /** Заказ в 1С создан: true — записали (повтор не перезаписывает). */
    setOnecOrder(id: number, guid: string, number: string, status: string, slot: { from: string | null, to: string | null }, now: string): boolean {
      return Number(setOnec.run(guid.toLowerCase(), number, status, slot.from, slot.to, now, id).changes) === 1
    },
    note(id: number, error: string, now: string) { setNote.run(error.slice(0, 200), now, id) },
    /**
     * Строка 1С о статусе → заявка ЛК только по GUID заказа, который ЛК сам записал при создании.
     * По externalId не ищем: строка 1С с чужим GUID и совпавшим номером сделки привязала бы чужой
     * заказ. Окно «заказ создан, GUID не записан» закрывает повтор POST /order — он идемпотентен.
     */
    findForStatus(orderGuid: string): OrderRowDb | undefined {
      return byOnec.get(orderGuid.toLowerCase()) as unknown as OrderRowDb | undefined
    },
    /** Рейс заказа: 1С может перенести заказ в другой рейс и без смены статуса. */
    setTrip(id: number, tripGuid: string | null): boolean {
      const guid = tripGuid?.toLowerCase() ?? null
      return Number(setTrip.run(guid, id, guid).changes) > 0
    },
    applyStatus(id: number, status: string, shipmentDate: string | null, number: string, now: string) {
      applyOnec.run(status, shipmentDate, number, now, id)
    },
    failed(id: number, error: string, now: string) { setError.run(error.slice(0, 200), now, id) },
    list(companyId: number, limit = 20, offset = 0): OrderListRow[] {
      const lim = Math.min(Math.max(Math.trunc(limit) || 20, 1), 50)
      const off = Math.min(Math.max(Math.trunc(offset) || 0, 0), 100_000)
      return (list.all(companyId, lim, off) as unknown as (Omit<OrderListRow, 'items'> & { items: string })[])
        .map(r => ({ ...r, items: JSON.parse(r.items) as OrderItem[] }))
    },
  }
}
export type OrderStore = ReturnType<typeof createOrderStore>

export interface SubmitInput { requestId: string, lines: CartLineInput[], addressGuid: string, comment: string }
export interface SubmitDeps {
  store: CatalogStore
  clients: ClientStore
  orders: OrderStore
  b24: Pick<B24Orders, 'createDeal'>
  schedules: () => Promise<TripSchedule[]>
  prices: PriceSource
  now?: () => Date
}

export type SubmitError = 'bad_request' | 'no_contract' | 'bad_address' | 'cart_invalid' | 'crm_unavailable' | 'in_progress' | 'already_sent'
export type SubmitResult =
  | { ok: true, orderId: number, dealId: number, deliveryFrom: string | null, deliveryTo: string | null }
  | { ok: false, status: number, error: SubmitError, quote?: Quote }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Описание сделки для менеджера: всё, что пришло извне, — без BB-разметки. */
export function dealComments(id: number, row: { address_text: string, delivery_from: string | null, delivery_to: string | null, comment: string }, cutoffAt?: string): string {
  return [
    `Заявка из личного кабинета №${id}.`,
    `Адрес доставки: ${neutralizeBb(row.address_text)}`,
    row.delivery_from && row.delivery_to
      ? `Ближайший рейс: ${formatSlot({ arrivalFrom: row.delivery_from, arrivalTo: row.delivery_to })}${cutoffAt ? ` (приём до ${formatCutoff(cutoffAt)})` : ''}`
      : 'Ближайший рейс не найден — согласуйте дату с клиентом.',
    row.comment ? `Комментарий клиента: ${neutralizeBb(row.comment)}` : '',
  ].filter(Boolean).join('\n')
}

export async function submitOrder(
  session: { companyId: number, contactId: number },
  pricing: ClientPricing,
  input: SubmitInput,
  deps: SubmitDeps,
): Promise<SubmitResult> {
  const now = deps.now?.() ?? new Date()
  const nowIso = now.toISOString()
  if (!UUID_RE.test(input.requestId) || input.lines.length === 0 || input.comment.length > COMMENT_MAX) return { ok: false, status: 400, error: 'bad_request' }
  if (pricing.status === 'no-contract') return { ok: false, status: 409, error: 'no_contract' }
  if (pricing.status !== 'ok') return { ok: false, status: 503, error: 'crm_unavailable' }
  const client = deps.clients.get(pricing.clientGuid)
  if (!client?.contractGuid || client.deleted) return { ok: false, status: 409, error: 'no_contract' }
  const address = client.addresses.find(a => a.guid === input.addressGuid.toLowerCase())
  if (!address) return { ok: false, status: 400, error: 'bad_address' }

  // Уже отправленная заявка с тем же requestId — ответ из базы, без пересчёта и без CRM.
  const existing = deps.orders.get(input.requestId)
  if (existing && existing.company_id !== session.companyId) return { ok: false, status: 400, error: 'bad_request' }

  const quote = await quoteCart(input.lines, deps.store, pricing, deps.prices)
  if (!quote.ok) return { ok: false, status: quote.priceStatus === 'unavailable' ? 503 : 422, error: 'cart_invalid', quote }

  // Рейс — подсказка клиенту и менеджеру, а не условие: сбой «Рейсов» заявку не останавливает.
  let slot: DeliverySlot | null = null
  try {
    slot = nextDelivery(await deps.schedules(), client.regionGuid, now)
  }
  catch (e) {
    console.error(`[orders] schedules: ${(e as Error).name}`)
  }

  const draft: OrderDraft = {
    requestId: input.requestId, companyId: session.companyId, contactId: session.contactId, clientGuid: client.guid,
    contractGuid: client.contractGuid, addressGuid: address.guid, addressText: addressLine(address.city, address.address), slot,
    items: quote.lines.map(l => ({ guid: l.guid, sku: l.sku, name: l.name, unit: l.unit, qty: l.qty, price: l.price!, vatRate: l.vatRate })),
    total: quote.total, currency: quote.currency!, comment: input.comment.trim(),
  }
  const hash = payloadHash(draft)
  let row = deps.orders.begin(draft, hash, nowIso)
  if (row.company_id !== session.companyId) return { ok: false, status: 400, error: 'bad_request' }
  if (row.payload_hash !== hash) {
    // Тот же requestId, другое содержимое: пока сделки нет — обновляем черновик, после — это новая заявка.
    if (row.deal_id || !deps.orders.replace(row.id, draft, hash, nowIso)) return { ok: false, status: 409, error: 'already_sent' }
    row = deps.orders.get(input.requestId)!
  }
  const done = (dealId: number): SubmitResult => ({ ok: true, orderId: row.id, dealId, deliveryFrom: row.delivery_from, deliveryTo: row.delivery_to })
  if (row.deal_id) return done(row.deal_id)
  if (!deps.orders.claim(row.id, now)) return { ok: false, status: 409, error: 'in_progress' }

  const dealId = await sendToCrm(row, client.name, deps, now, slot?.cutoffAt)
  return dealId ? done(dealId) : { ok: false, status: 503, error: 'crm_unavailable' }
}

/**
 * Сделка из сохранённой строки заявки (вызывающий уже захватил отправку): что в базе, то и у
 * менеджера. Отказ CRM — null и черновик снова `pending`; в журнал — только класс ошибки: текст
 * транспорта может содержать адрес вебхука (секрет).
 */
export async function sendToCrm(
  row: OrderRowDb,
  clientName: string,
  deps: Pick<SubmitDeps, 'orders' | 'b24'>,
  now: Date,
  cutoffAt?: string,
): Promise<number | null> {
  const items = JSON.parse(row.items) as OrderItem[]
  try {
    const dealId = await deps.b24.createDeal({
      requestId: row.request_id,
      companyId: row.company_id,
      contactId: row.contact_id,
      title: `Заявка ЛК №${row.id}: ${neutralizeBb(clientName)}`,
      comments: dealComments(row.id, row, cutoffAt),
      total: row.total,
      currency: row.currency,
      rows: items.map(i => ({ name: neutralizeBb(`${i.name} (${i.sku})`), price: i.price, qty: i.qty, unit: i.unit, vatRate: i.vatRate })),
    })
    deps.orders.sent(row.id, dealId, now.toISOString())
    return dealId
  }
  catch (e) {
    const kind = (e as Error).name || 'Error'
    deps.orders.failed(row.id, kind, now.toISOString())
    console.error(`[orders] deal for order ${row.id}: ${kind}`)
    return null
  }
}
