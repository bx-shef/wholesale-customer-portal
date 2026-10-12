/**
 * Заявки ЛК ↔ CRM ↔ 1С по расписанию (docs/spec.md §1, шаги 6–7). Чистые шаги с внедряемыми
 * зависимостями — tests/orderSync.test.ts.
 *
 * 1. Досылка: заявка без сделки (CRM упала, клиент закрыл вкладку) уходит в CRM сама.
 * 2. Подтверждение: менеджер перевёл сделку из первой стадии воронки в любую рабочую — заявка
 *    уходит заказом в 1С (`POST /order`, `externalId` = ID сделки: повтор возвращает тот же заказ).
 *    Сделка проиграна — заявка отменена, в 1С ничего не уходит. Событие `ONCRMDEALUPDATE` не
 *    используем: `event.bind` требует контекста приложения (docs/REST_METHODS.md), опроса хватает.
 * 3. Статусы 1С (`GET /orders/status` по курсору) → «Мои заявки»; в сделку — комментарий в ленте,
 *    «доставлена» — стадия успеха, «отменена» — провала.
 */
import type { OrderRequestT, OrderStatusRowT, OrderStatusT } from '../../shared/onec/schemas'
import { MINSK_OFFSET_MIN } from '../../shared/delivery'
import type { DealStage, B24Orders } from '../services/b24Orders'
import type { ClientStore } from './clients'
import { sendToCrm, type OrderItem, type OrderStore } from './orders'

export interface OrderSyncDeps {
  orders: OrderStore
  clients: ClientStore
  b24: Pick<B24Orders, 'createDeal' | 'stages' | 'dealStage' | 'moveDeal' | 'comment'>
  createOnecOrder: (order: OrderRequestT) => Promise<{ orderGuid: string, number: string, status: OrderStatusT }>
  now?: () => Date
}

export const ONEC_STATUS_LABEL: Record<OrderStatusT, string> = {
  new: 'Новая', confirmed: 'Подтверждена', assembled: 'Собрана', shipped: 'В пути', delivered: 'Доставлена', cancelled: 'Отменена',
}

/** Дата доставки для 1С: день рейса по Минску; рейса нет — завтра по Минску (менеджер согласует). */
export function deliveryDateFor(deliveryFrom: string | null, now: Date): string {
  const shift = MINSK_OFFSET_MIN * 60_000
  if (deliveryFrom) return new Date(Date.parse(deliveryFrom) + shift).toISOString().slice(0, 10)
  return new Date(now.getTime() + shift + 86_400_000).toISOString().slice(0, 10)
}

export interface SyncSummary { resent: number, ordered: number, cancelled: number, failed: number }

export async function syncOrders(deps: OrderSyncDeps): Promise<SyncSummary> {
  const now = deps.now?.() ?? new Date()
  const iso = now.toISOString()
  const summary: SyncSummary = { resent: 0, ordered: 0, cancelled: 0, failed: 0 }

  // 1. Досылка зависших без сделки.
  for (const row of deps.orders.toResend(now)) {
    if (!deps.orders.claim(row.id, now)) continue
    const client = deps.clients.get(row.client_guid)
    const dealId = await sendToCrm(row, client?.name ?? '', deps, now)
    if (dealId) summary.resent++
    else summary.failed++
  }

  // 2. Подтверждение менеджером → заказ в 1С.
  const waiting = deps.orders.awaitingConfirmation()
  if (waiting.length === 0) return summary
  const stages = await deps.b24.stages()
  const initial = stages.find(s => s.semantics === 'process')
  if (!initial) throw new Error('Deal category has no working stages')
  const byId = new Map<string, DealStage>(stages.map(s => [s.id, s]))
  for (const row of waiting) {
    try {
      const stageId = await deps.b24.dealStage(row.deal_id!)
      const stage = stageId ? byId.get(stageId) : undefined
      if (!stage || stage.id === initial.id) continue
      if (stage.semantics === 'failure') {
        deps.orders.setStatus(row.id, 'cancelled', iso)
        summary.cancelled++
        continue
      }
      const items = JSON.parse(row.items) as OrderItem[]
      const created = await deps.createOnecOrder({
        externalId: String(row.deal_id),
        clientGuid: row.client_guid,
        contractGuid: row.contract_guid,
        deliveryAddressGuid: row.address_guid,
        deliveryDate: deliveryDateFor(row.delivery_from, now),
        comment: row.comment,
        items: items.map(i => ({ itemGuid: i.guid, qty: i.qty, price: i.price })),
      })
      if (deps.orders.setOnecOrder(row.id, created.orderGuid, created.number, created.status, iso)) {
        summary.ordered++
        await deps.b24.comment(row.deal_id!, `Заказ в 1С создан: № ${created.number}.`).catch(() => {})
      }
    }
    catch (e) {
      // Одна заявка не держит остальные: причина — в строке, повтор — следующим запуском.
      const kind = (e as Error).name || 'Error'
      deps.orders.note(row.id, kind, iso)
      console.error(`[orders:sync] order ${row.id}: ${kind}`)
      summary.failed++
    }
  }
  return summary
}

/** Строки статусов из 1С → заявки ЛК и сделки. Незнакомые заказы (созданы не из ЛК) пропускаются. */
export async function applyOnecStatuses(rows: OrderStatusRowT[], deps: Pick<OrderSyncDeps, 'orders' | 'b24' | 'now'>): Promise<number> {
  const iso = (deps.now?.() ?? new Date()).toISOString()
  let applied = 0
  let stages: DealStage[] | undefined
  for (const r of rows) {
    const order = deps.orders.findForStatus(r.orderGuid, r.externalId)
    if (!order) continue
    const changed = order.status !== r.status
    deps.orders.applyStatus(order.id, r.status, r.shipmentDate, r.number, r.orderGuid, iso)
    applied++
    if (!changed || !order.deal_id) continue
    // Сделку двигаем только к закрытию; промежуточные статусы — комментарием в ленте.
    if (r.status === 'delivered' || r.status === 'cancelled') {
      stages ??= await deps.b24.stages()
      const target = stages.find(s => s.semantics === (r.status === 'delivered' ? 'success' : 'failure'))
      if (target) await deps.b24.moveDeal(order.deal_id, target.id)
    }
    const shipment = r.shipmentDate ? `, отгрузка ${r.shipmentDate}` : ''
    await deps.b24.comment(order.deal_id, `Статус в 1С: ${ONEC_STATUS_LABEL[r.status]}${shipment}.`)
  }
  return applied
}
