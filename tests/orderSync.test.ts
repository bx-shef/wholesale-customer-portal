import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { migrate } from '../server/db/sqlite'
import { createClientStore } from '../server/utils/clients'
import { createOrderStore, resendPauseMs, type OrderDraft } from '../server/utils/orders'
import { applyOnecStatuses, deliveryDateFor, isForward, reportToCrm, syncOrders, type OrderSyncDeps } from '../server/utils/orderSync'
import type { DealStage } from '../server/services/b24Orders'
import type { OrderStatusRowT } from '../shared/onec/schemas'

const g = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const NOW = new Date('2026-10-12T10:00:00Z')
const stages: DealStage[] = [
  { id: 'C9:NEW', name: 'Новая', sort: 10, semantics: 'process' },
  { id: 'C9:PREPARATION', name: 'Подтверждена', sort: 20, semantics: 'process' },
  { id: 'C9:ODD', name: 'Странная', sort: 25, semantics: 'unknown' },
  { id: 'C9:WON', name: 'Доставлена', sort: 30, semantics: 'success' },
  { id: 'C9:LOSE', name: 'Отменена', sort: 40, semantics: 'failure' },
]
const minskTueFri = [{ city: 'Минск', weekdays: [2, 5], cutoffDaysBefore: 1, cutoffMinutes: 16 * 60, arrivalFromMinutes: 600, arrivalToMinutes: 840, exceptions: [] }]
const draft = (n: number, over: Partial<OrderDraft> = {}): OrderDraft => ({
  requestId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, companyId: 7, contactId: 5, clientGuid: g(100), contractGuid: g(200),
  addressGuid: g(300), addressText: 'Минск, ул. 1', slot: { date: '2026-10-13', arrivalFrom: '2026-10-13T07:00:00.000Z', arrivalTo: '2026-10-13T11:00:00.000Z', cutoffAt: '2026-10-12T13:00:00.000Z' },
  items: [{ guid: g(1), sku: 'A', name: 'Товар', unit: 'шт', qty: 2, price: 5, vatRate: 20 }], total: 10, currency: 'BYN', comment: 'к', ...over,
})
const status = (s: OrderStatusRowT['status'], over: Partial<OrderStatusRowT> = {}): OrderStatusRowT =>
  ({ orderGuid: g(900).toUpperCase(), externalId: '501', number: 'ЛК-1', status: s, shipmentDate: null, changedAt: NOW.toISOString(), ...over })

describe('синхронизация заявок', () => {
  let db: DatabaseSync
  let deps: OrderSyncDeps & { b24: Record<string, ReturnType<typeof vi.fn>>, createOnecOrder: ReturnType<typeof vi.fn>, schedules: ReturnType<typeof vi.fn> }
  let stageOf: Record<number, string | null>
  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    migrate(db)
    createClientStore(db).save([{ guid: g(100), name: 'ООО «К»', unp: '', address: '', city: 'Минск', managerEmail: '', contractGuid: g(200),
      deliveryAddresses: [{ guid: g(300), city: 'Минск', address: 'ул. 1' }], changedAt: NOW.toISOString(), deleted: false }])
    stageOf = {}
    deps = {
      orders: createOrderStore(db),
      clients: createClientStore(db),
      b24: {
        createDeal: vi.fn(async () => 501),
        stages: vi.fn(async () => stages),
        dealStage: vi.fn(async (id: number) => (id in stageOf ? stageOf[id]! : 'C9:NEW')),
        moveDeal: vi.fn(async () => {}),
        comment: vi.fn(async () => {}),
      },
      createOnecOrder: vi.fn(async (o: { items: { itemGuid: string, qty: number, price: number }[] }) => ({ orderGuid: g(900).toUpperCase(), number: 'ЛК-1', status: 'new' as const, items: o.items.map(i => ({ itemGuid: i.itemGuid, price: i.price, reserved: i.qty })) })),
      schedules: vi.fn(async () => minskTueFri),
      now: () => NOW,
    }
  })
  const begin = (n: number, at: string) => deps.orders.begin(draft(n), 'h', at)
  const sent = (n: number, dealId: number) => {
    const row = begin(n, '2026-10-12T09:00:00Z')
    deps.orders.sent(row.id, dealId, '2026-10-12T09:00:00Z')
    return row.id
  }
  const confirmed = async (n = 1, dealId = 501) => {
    const id = sent(n, dealId)
    stageOf[dealId] = 'C9:PREPARATION'
    await syncOrders(deps)
    return id
  }

  describe('досылка', () => {
    it('старше минуты — досылается; моложе — нет; со сделкой — нет', async () => {
      begin(1, '2026-10-12T09:58:30Z')
      begin(2, '2026-10-12T09:59:30Z')
      sent(3, 777)
      expect(await syncOrders(deps)).toMatchObject({ resent: 1 })
      expect(deps.b24.createDeal.mock.calls[0]![0]).toMatchObject({ requestId: draft(1).requestId, title: 'Заявка ЛК №1: ООО «К»', total: 10 })
    })

    it('отказ CRM — failed, заявка снова pending, пауза растёт', async () => {
      const row = begin(1, '2026-10-12T09:00:00Z')
      deps.b24.createDeal.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AjaxError' }))
      expect(await syncOrders(deps)).toMatchObject({ resent: 0, failed: 1 })
      expect(deps.orders.byId(row.id)).toMatchObject({ status: 'pending', error: 'AjaxError', attempts: 1 })
      // Сразу следующий запуск не повторяет — пауза минута.
      await syncOrders(deps)
      expect(deps.b24.createDeal).toHaveBeenCalledTimes(1)
      // Через 70 с — повтор, снова отказ: пауза уже 2 минуты, через следующие 70 с повтора нет.
      let t = NOW.getTime() + 70_000
      deps.now = () => new Date(t)
      deps.b24.createDeal.mockRejectedValueOnce(new Error('503'))
      await syncOrders(deps)
      expect(deps.b24.createDeal).toHaveBeenCalledTimes(2)
      t += 70_000
      await syncOrders(deps)
      expect(deps.b24.createDeal).toHaveBeenCalledTimes(2)
      t += 60_000
      await syncOrders(deps)
      expect(deps.b24.createDeal).toHaveBeenCalledTimes(3)
      expect(resendPauseMs(1)).toBe(60_000)
      expect(resendPauseMs(3)).toBe(4 * 60_000)
      expect(resendPauseMs(30)).toBe(60 * 60_000)
    })

    it('свежий чужой захват (sending) не перехватывается', async () => {
      const row = begin(1, '2026-10-12T09:00:00Z')
      expect(deps.orders.claim(row.id, new Date('2026-10-12T09:59:30Z'))).toBe(true)
      await syncOrders(deps)
      expect(deps.b24.createDeal).not.toHaveBeenCalled()
    })
  })

  describe('подтверждение', () => {
    it('первая стадия — ждём; без ожидающих стадии не запрашиваются', async () => {
      await syncOrders(deps)
      expect(deps.b24.stages).not.toHaveBeenCalled()
      sent(1, 501)
      await syncOrders(deps)
      expect(deps.createOnecOrder).not.toHaveBeenCalled()
    })

    it('подтверждена — заказ в 1С с externalId = ID сделки, один раз', async () => {
      const id = await confirmed()
      expect(deps.createOnecOrder).toHaveBeenCalledTimes(1)
      expect(deps.createOnecOrder.mock.calls[0]![0]).toMatchObject({
        externalId: '501', clientGuid: g(100), contractGuid: g(200), deliveryAddressGuid: g(300), comment: 'к', items: [{ itemGuid: g(1), qty: 2, price: 5 }],
      })
      expect(deps.orders.byId(id)).toMatchObject({ status: 'new', onec_order_guid: g(900), onec_number: 'ЛК-1' })
      await syncOrders(deps)
      expect(deps.createOnecOrder).toHaveBeenCalledTimes(1)
      expect(deps.orders.setOnecOrder(id, g(901), 'X', 'new', { from: null, to: null }, NOW.toISOString())).toBe(false)
      expect(deps.orders.byId(id)!.onec_order_guid).toBe(g(900))
    })

    it('дата доставки — на момент подтверждения: после отсечки — следующий рейс', async () => {
      // Отправлена до отсечки на вт 13-го, подтверждена в пн 12-го после 16:00 по Минску → пт 16-го.
      const late = new Date('2026-10-12T14:00:00Z')
      deps.now = () => late
      const id = sent(1, 501)
      stageOf[501] = 'C9:PREPARATION'
      await syncOrders(deps)
      expect(deps.createOnecOrder.mock.calls[0]![0].deliveryDate).toBe('2026-10-16')
      expect(deps.orders.byId(id)!.delivery_from).toBe('2026-10-16T07:00:00.000Z')
    })

    it('проиграна или удалена — отмена, в 1С ничего; неизвестная стадия — ждём', async () => {
      const lost = sent(1, 501)
      const gone = sent(2, 502)
      const odd = sent(3, 503)
      stageOf[501] = 'C9:LOSE'
      stageOf[502] = null
      stageOf[503] = 'C9:ODD'
      expect(await syncOrders(deps)).toMatchObject({ cancelled: 2 })
      expect(deps.createOnecOrder).not.toHaveBeenCalled()
      expect(deps.orders.byId(lost)!.status).toBe('cancelled')
      expect(deps.orders.byId(gone)!.status).toBe('cancelled')
      expect(deps.orders.byId(odd)!.status).toBe('sent')
    })

    it('очередь по кругу: молчащие сделки не держат новые', async () => {
      for (let i = 1; i <= 3; i++) sent(i, 500 + i)
      expect(deps.orders.awaitingConfirmation(2).map(r => r.id)).toEqual([1, 2])
      deps.orders.checked(1, '2026-10-12T10:00:00Z')
      deps.orders.checked(2, '2026-10-12T10:00:01Z')
      expect(deps.orders.awaitingConfirmation(2).map(r => r.id)).toEqual([3, 1])
      // Запуск отмечает проверенные — следующий начинает с давно не проверенных.
      await syncOrders(deps)
      expect(deps.orders.byId(3)!.checked_at).toBe(NOW.toISOString())
    })

    it('сбой 1С на одной заявке не держит другие; причина — в строке', async () => {
      const a = sent(1, 501)
      const b = sent(2, 502)
      stageOf[501] = stageOf[502] = 'C9:PREPARATION'
      deps.createOnecOrder.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'OnecError' }))
      expect(await syncOrders(deps)).toMatchObject({ ordered: 1, failed: 1 })
      expect(deps.orders.byId(a)).toMatchObject({ status: 'sent', error: 'OnecError' })
      expect(deps.orders.byId(b)!.status).toBe('new')
    })

    it('в воронке нет рабочих стадий — ошибка, а не тихий пропуск', async () => {
      sent(1, 501)
      deps.b24.stages.mockResolvedValueOnce(stages.filter(s => s.semantics !== 'process'))
      await expect(syncOrders(deps)).rejects.toThrow('no working stages')
    })
  })

  describe('статусы 1С и сделка', () => {
    it('только по GUID, который ЛК записал; чужой GUID с тем же номером сделки не привязывается', async () => {
      const id = await confirmed()
      expect(applyOnecStatuses([status('shipped', { orderGuid: g(901) })], deps)).toBe(0)
      expect(applyOnecStatuses([status('shipped', { shipmentDate: '2026-10-16' })], deps)).toBe(1)
      expect(deps.orders.byId(id)).toMatchObject({ status: 'shipped', shipment_date: '2026-10-16', onec_order_guid: g(900) })
    })

    it('только вперёд: старый статус не откатывает, закрытые не воскресают', async () => {
      const id = await confirmed()
      applyOnecStatuses([status('shipped')], deps)
      expect(applyOnecStatuses([status('confirmed')], deps)).toBe(0)
      applyOnecStatuses([status('cancelled')], deps)
      expect(applyOnecStatuses([status('delivered')], deps)).toBe(0)
      expect(deps.orders.byId(id)!.status).toBe('cancelled')
      expect(isForward('sent', 'new')).toBe(true)
      expect(isForward('delivered', 'cancelled')).toBe(false)
    })

    it('в сделку: создание заказа, затем статусы; «доставлена» — стадия успеха; повтор не дублирует', async () => {
      await confirmed()
      expect(deps.b24.comment).toHaveBeenLastCalledWith(501, 'Заказ в 1С создан: № ЛК-1. Статус: Новая.')
      applyOnecStatuses([status('shipped', { shipmentDate: '2026-10-16' })], deps)
      await reportToCrm(deps, async () => stages)
      expect(deps.b24.comment).toHaveBeenLastCalledWith(501, 'Статус в 1С: В пути, отгрузка 2026-10-16.')
      expect(deps.b24.moveDeal).not.toHaveBeenCalled()
      applyOnecStatuses([status('delivered')], deps)
      await reportToCrm(deps, async () => stages)
      expect(deps.b24.moveDeal).toHaveBeenCalledWith(501, 'C9:WON')
      const calls = deps.b24.comment.mock.calls.length
      expect(await reportToCrm(deps, async () => stages)).toBe(0)
      expect(deps.b24.comment.mock.calls.length).toBe(calls)
    })

    it('сбой CRM при сообщении не теряется: следующий запуск сообщает снова', async () => {
      deps.b24.comment.mockRejectedValueOnce(new Error('503'))
      const id = await confirmed()
      expect(deps.orders.byId(id)!.crm_status).toBeNull()
      await reportToCrm(deps, async () => stages)
      expect(deps.orders.byId(id)!.crm_status).toBe('new')
    })

    it('отмена в 1С — стадия провала; номер заказа из 1С обезврежен от BB', async () => {
      deps.createOnecOrder.mockResolvedValueOnce({ orderGuid: g(900), number: '[url=x]1[/url]', status: 'new' })
      await confirmed()
      expect(deps.b24.comment.mock.calls[0]![1]).toContain('［url=x］1［/url］')
      applyOnecStatuses([status('cancelled')], deps)
      await reportToCrm(deps, async () => stages)
      expect(deps.b24.moveDeal).toHaveBeenCalledWith(501, 'C9:LOSE')
    })
  })

  it('дата доставки — день рейса по Минску; без рейса — завтра по Минску', () => {
    expect(deliveryDateFor('2026-10-13T22:30:00.000Z', NOW)).toBe('2026-10-14')
    expect(deliveryDateFor(null, new Date('2026-10-12T22:00:00Z'))).toBe('2026-10-14')
  })
})
