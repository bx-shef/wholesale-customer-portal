/**
 * Заявки ЛК ↔ CRM ↔ 1С по расписанию (docs/spec.md §1, шаги 6–7). Чистые шаги с внедряемыми
 * зависимостями — tests/orderSync.test.ts.
 *
 * 1. Досылка: заявка без сделки (CRM упала, клиент закрыл вкладку) уходит в CRM сама; пауза между
 *    попытками растёт до часа.
 * 2. Подтверждение: менеджер перевёл сделку из первой рабочей стадии воронки «Заявки ЛК» в любую
 *    другую рабочую — заявка уходит заказом в 1С (`externalId` = ID сделки, повтор возвращает тот
 *    же заказ). Дата доставки пересчитывается на момент подтверждения (§8: успели до отсечки —
 *    ближайший рейс, нет — следующий). Сделка проиграна или удалена — заявка отменена, в 1С ничего.
 *    Сделки проверяются по кругу (давно не проверенные — первыми), не больше 50 за запуск.
 *    Событие `ONCRMDEALUPDATE` не используем: `event.bind` требует контекста приложения.
 * 3. Статусы 1С (`GET /orders/status` по курсору) → база ЛК, только вперёд по жизненному циклу;
 *    курсор зависит лишь от записи в базу, а не от CRM.
 * 4. Сообщение в сделку: где статус в базе опережает сообщённый — комментарий в ленте,
 *    «доставлена»/«отменена» — стадия успеха/провала. Сбой CRM повторяется следующим запуском.
 */
import type { OrderLineFactT, OrderRequestT, OrderStatusRowT, OrderStatusT } from '../../shared/onec/schemas'
import { neutralizeBb } from '../../shared/cart'
import { MINSK_OFFSET_MIN, nextDelivery, type TripSchedule } from '../../shared/delivery'
import type { DealStage, B24Orders } from '../services/b24Orders'
import type { ClientStore } from './clients'
import { sendToCrm, type OrderItem, type OrderStore } from './orders'

export interface OrderSyncDeps {
  orders: OrderStore
  clients: ClientStore
  b24: Pick<B24Orders, 'createDeal' | 'stages' | 'dealStage' | 'moveDeal' | 'comment'>
  createOnecOrder: (order: OrderRequestT) => Promise<{ orderGuid: string, number: string, status: OrderStatusT, items: OrderLineFactT[] }>
  schedules: () => Promise<TripSchedule[]>
  now?: () => Date
}

export const ONEC_STATUS_LABEL: Record<OrderStatusT, string> = {
  new: 'Новая', confirmed: 'Подтверждена', assembled: 'Собрана', shipped: 'В пути', delivered: 'Доставлена', cancelled: 'Отменена',
}

/** Порядок жизненного цикла: старый статус из 1С не откатывает новый, закрытые не «воскресают». */
const RANK: Record<string, number> = { new: 1, confirmed: 2, assembled: 3, shipped: 4, delivered: 9, cancelled: 9 }
export function isForward(from: string, to: string): boolean {
  return (RANK[to] ?? 0) > (RANK[from] ?? 0)
}

const MINSK_SHIFT = MINSK_OFFSET_MIN * 60_000
/** Дата доставки для 1С: день рейса по Минску; рейса нет — завтра по Минску (дату согласует менеджер). */
export function deliveryDateFor(deliveryFrom: string | null, now: Date): string {
  if (deliveryFrom) return new Date(Date.parse(deliveryFrom) + MINSK_SHIFT).toISOString().slice(0, 10)
  return new Date(now.getTime() + MINSK_SHIFT + 86_400_000).toISOString().slice(0, 10)
}

/**
 * Расхождения между заявкой и тем, с чем 1С приняла заказ (§2.6): цена и резерв по строкам.
 * Нет расхождений — `null`. Текст — для ленты сделки (BB-разметка), поэтому название — через neutralizeBb.
 */
export function orderFactsDiff(items: OrderItem[], facts: OrderLineFactT[]): string | null {
  const byGuid = new Map(facts.map(f => [f.itemGuid.toLowerCase(), f]))
  const money = (v: number) => v.toFixed(2).replace('.', ',')
  const lines: string[] = []
  for (const it of items) {
    const f = byGuid.get(it.guid.toLowerCase())
    if (!f) {
      lines.push(`${neutralizeBb(it.sku || it.name)}: 1С не вернула строку`)
      continue
    }
    const parts: string[] = []
    if (Math.abs(f.price - it.price) >= 0.005) parts.push(`цена ${money(it.price)} → ${money(f.price)}`)
    if (f.reserved < it.qty) parts.push(`резерв ${f.reserved} из ${it.qty} ${it.unit}`)
    if (parts.length) lines.push(`${neutralizeBb(it.sku || it.name)}: ${parts.join('; ')}`)
  }
  return lines.length ? `Расхождения при создании заказа в 1С — согласуйте с клиентом:\n${lines.join('\n')}` : null
}

export interface SyncSummary { resent: number, ordered: number, cancelled: number, reported: number, failed: number }

const errKind = (e: unknown) => (e as Error)?.name || 'Error'

export async function syncOrders(deps: OrderSyncDeps): Promise<SyncSummary> {
  const now = deps.now?.() ?? new Date()
  const iso = now.toISOString()
  const summary: SyncSummary = { resent: 0, ordered: 0, cancelled: 0, reported: 0, failed: 0 }

  // 1. Досылка зависших без сделки.
  for (const row of deps.orders.toResend(now)) {
    if (!deps.orders.claim(row.id, now)) continue
    const client = deps.clients.get(row.client_guid)
    if (await sendToCrm(row, client?.name ?? '', deps, now)) summary.resent++
    else summary.failed++
  }

  let stages: DealStage[] | undefined
  const getStages = async () => (stages ??= await deps.b24.stages())

  // 2. Подтверждение менеджером → заказ в 1С.
  const waiting = deps.orders.awaitingConfirmation()
  if (waiting.length) {
    const all = await getStages()
    const initial = all.find(s => s.semantics === 'process')
    if (!initial) throw new Error('Deal category has no working stages')
    const byId = new Map(all.map(s => [s.id, s]))
    let schedules: TripSchedule[] | null | undefined
    for (const row of waiting) {
      deps.orders.checked(row.id, iso)
      try {
        const stageId = await deps.b24.dealStage(row.deal_id!)
        if (stageId === null) {
          // Сделку удалили — заявки больше нет; в 1С ничего не уходит.
          deps.orders.setStatus(row.id, 'cancelled', iso)
          summary.cancelled++
          continue
        }
        const stage = byId.get(stageId)
        // Чужая воронка или неизвестная семантика — заказ не создаём: лучше подождать человека, чем
        // отправить в 1С проигранную сделку.
        if (!stage || stage.semantics === 'unknown' || stage.id === initial.id) continue
        if (stage.semantics === 'failure') {
          deps.orders.setStatus(row.id, 'cancelled', iso)
          summary.cancelled++
          continue
        }
        // Дата — на момент подтверждения: менеджер мог подтвердить уже после отсечки.
        if (schedules === undefined) schedules = await deps.schedules().catch(() => null)
        const city = deps.clients.get(row.client_guid)?.addresses.find(a => a.guid === row.address_guid)?.city
        const slot = schedules && city ? nextDelivery(schedules, city, now) : null
        const from = slot?.arrivalFrom ?? null
        const items = JSON.parse(row.items) as OrderItem[]
        const created = await deps.createOnecOrder({
          externalId: String(row.deal_id),
          clientGuid: row.client_guid,
          contractGuid: row.contract_guid,
          deliveryAddressGuid: row.address_guid,
          deliveryDate: deliveryDateFor(from, now),
          comment: row.comment,
          items: items.map(i => ({ itemGuid: i.guid, qty: i.qty, price: i.price })),
        })
        if (deps.orders.setOnecOrder(row.id, created.orderGuid, created.number, created.status, { from, to: slot?.arrivalTo ?? null }, iso)) {
          summary.ordered++
          // Сверка цен и остатков — здесь (§2.6): расхождения — менеджеру в сделку. Заказ уже создан,
          // поэтому сбой комментария его не откатывает.
          const diff = orderFactsDiff(items, created.items)
          if (diff) await deps.b24.comment(row.deal_id!, diff).catch(e => console.error(`[orders:sync] diff comment ${row.id}: ${errKind(e)}`))
        }
      }
      catch (e) {
        // Одна заявка не держит остальные: класс ошибки — в строке, повтор — следующим кругом.
        deps.orders.note(row.id, errKind(e), iso)
        console.error(`[orders:sync] order ${row.id}: ${errKind(e)}`)
        summary.failed++
      }
    }
  }

  // 4. Сообщить в сделки то, что ещё не сообщено.
  summary.reported = await reportToCrm(deps, getStages)
  return summary
}

/** Строки статусов из 1С → база ЛК. Только вперёд по жизненному циклу; заказы не из ЛК пропускаются. */
export function applyOnecStatuses(rows: OrderStatusRowT[], deps: Pick<OrderSyncDeps, 'orders' | 'now'>): number {
  const iso = (deps.now?.() ?? new Date()).toISOString()
  let applied = 0
  for (const r of rows) {
    const order = deps.orders.findForStatus(r.orderGuid)
    if (!order || !isForward(order.status, r.status)) continue
    deps.orders.applyStatus(order.id, r.status, r.shipmentDate, r.number, iso)
    applied++
  }
  return applied
}

/** Комментарий и закрытие сделки по статусу из базы. Каждая сделка — отдельно; сбой повторится. */
export async function reportToCrm(deps: Pick<OrderSyncDeps, 'orders' | 'b24'>, getStages: () => Promise<DealStage[]>): Promise<number> {
  let reported = 0
  for (const row of deps.orders.crmBehind()) {
    try {
      const status = row.status as OrderStatusT
      if (status === 'delivered' || status === 'cancelled') {
        const target = (await getStages()).find(s => s.semantics === (status === 'delivered' ? 'success' : 'failure'))
        if (target) await deps.b24.moveDeal(row.deal_id!, target.id)
      }
      const number = neutralizeBb(row.onec_number ?? '')
      const text = row.crm_status === null
        ? `Заказ в 1С создан: № ${number}. Статус: ${ONEC_STATUS_LABEL[status] ?? status}.`
        : `Статус в 1С: ${ONEC_STATUS_LABEL[status] ?? status}${row.shipment_date ? `, отгрузка ${row.shipment_date}` : ''}.`
      await deps.b24.comment(row.deal_id!, text)
      deps.orders.crmReported(row.id, status)
      reported++
    }
    catch (e) {
      console.error(`[orders:sync] report order ${row.id}: ${errKind(e)}`)
    }
  }
  return reported
}
