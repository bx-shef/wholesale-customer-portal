import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { migrate } from '../server/db/sqlite'
import { createClientStore } from '../server/utils/clients'
import { createOrderStore, type OrderDraft } from '../server/utils/orders'
import { applyOnecStatuses, deliveryDateFor, syncOrders, type OrderSyncDeps } from '../server/utils/orderSync'
import type { DealStage } from '../server/services/b24Orders'

const g = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const NOW = new Date('2026-10-12T10:00:00Z')
const stages: DealStage[] = [
  { id: 'C9:NEW', name: 'Новая', sort: 10, semantics: 'process' },
  { id: 'C9:PREPARATION', name: 'Подтверждена', sort: 20, semantics: 'process' },
  { id: 'C9:WON', name: 'Доставлена', sort: 30, semantics: 'success' },
  { id: 'C9:LOSE', name: 'Отменена', sort: 40, semantics: 'failure' },
]
const draft = (n: number, over: Partial<OrderDraft> = {}): OrderDraft => ({
  requestId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, companyId: 7, contactId: 5, clientGuid: g(100), contractGuid: g(200),
  addressGuid: g(300), addressText: 'Минск, ул. 1', slot: { date: '2026-10-14', arrivalFrom: '2026-10-14T07:00:00.000Z', arrivalTo: '2026-10-14T11:00:00.000Z', cutoffAt: '2026-10-13T13:00:00.000Z' },
  items: [{ guid: g(1), sku: 'A', name: 'Товар', unit: 'шт', qty: 2, price: 5, vatRate: 20 }], total: 10, currency: 'BYN', comment: 'к', ...over,
})

describe('синхронизация заявок', () => {
  let db: DatabaseSync
  let deps: OrderSyncDeps & { b24: Record<string, ReturnType<typeof vi.fn>>, createOnecOrder: ReturnType<typeof vi.fn> }
  let stageOf: Record<number, string>
  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    migrate(db)
    createClientStore(db).save([{ guid: g(100), name: 'ООО «К»', unp: '', address: '', city: '', managerEmail: '', contractGuid: g(200), deliveryAddresses: [], changedAt: NOW.toISOString(), deleted: false }])
    stageOf = {}
    deps = {
      orders: createOrderStore(db),
      clients: createClientStore(db),
      b24: {
        createDeal: vi.fn(async () => 501),
        stages: vi.fn(async () => stages),
        dealStage: vi.fn(async (id: number) => stageOf[id] ?? 'C9:NEW'),
        moveDeal: vi.fn(async () => {}),
        comment: vi.fn(async () => {}),
      },
      createOnecOrder: vi.fn(async () => ({ orderGuid: g(900).toUpperCase(), number: 'ЛК-1', status: 'new' as const })),
      now: () => NOW,
    }
  })
  const sent = (n: number, dealId: number) => {
    const row = deps.orders.begin(draft(n), 'h', '2026-10-12T09:00:00Z')
    deps.orders.sent(row.id, dealId, '2026-10-12T09:00:00Z')
    return row.id
  }

  it('заявка без сделки досылается в CRM; свежая и чужая попытка — нет', async () => {
    deps.orders.begin(draft(1), 'h', '2026-10-12T09:00:00Z')
    deps.orders.begin(draft(2), 'h', NOW.toISOString())
    expect(await syncOrders(deps)).toMatchObject({ resent: 1 })
    expect(deps.b24.createDeal).toHaveBeenCalledTimes(1)
    expect(deps.b24.createDeal.mock.calls[0]![0]).toMatchObject({ requestId: draft(1).requestId, title: 'Заявка ЛК №1: ООО «К»', total: 10 })
  })

  it('сделка в первой стадии — ждём; перешла дальше — заказ в 1С с externalId = ID сделки', async () => {
    const id = sent(1, 501)
    await syncOrders(deps)
    expect(deps.createOnecOrder).not.toHaveBeenCalled()
    stageOf[501] = 'C9:PREPARATION'
    expect(await syncOrders(deps)).toMatchObject({ ordered: 1 })
    expect(deps.createOnecOrder.mock.calls[0]![0]).toEqual({
      externalId: '501', clientGuid: g(100), contractGuid: g(200), deliveryAddressGuid: g(300), deliveryDate: '2026-10-14',
      comment: 'к', items: [{ itemGuid: g(1), qty: 2, price: 5 }],
    })
    expect(deps.orders.byId(id)).toMatchObject({ status: 'new', onec_order_guid: g(900), onec_number: 'ЛК-1' })
    await syncOrders(deps)
    expect(deps.createOnecOrder).toHaveBeenCalledTimes(1)
  })

  it('сделка проиграна — заявка отменена, в 1С ничего', async () => {
    const id = sent(1, 501)
    stageOf[501] = 'C9:LOSE'
    expect(await syncOrders(deps)).toMatchObject({ cancelled: 1 })
    expect(deps.createOnecOrder).not.toHaveBeenCalled()
    expect(deps.orders.byId(id)!.status).toBe('cancelled')
  })

  it('сбой 1С на одной заявке не держит другие; причина — в строке, повтор — следующим запуском', async () => {
    const a = sent(1, 501)
    const b = sent(2, 502)
    stageOf[501] = stageOf[502] = 'C9:PREPARATION'
    deps.createOnecOrder.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'OnecError' }))
    expect(await syncOrders(deps)).toMatchObject({ ordered: 1, failed: 1 })
    expect(deps.orders.byId(a)).toMatchObject({ status: 'sent', error: 'OnecError' })
    expect(deps.orders.byId(b)!.status).toBe('new')
    await syncOrders(deps)
    expect(deps.orders.byId(a)!.status).toBe('new')
  })

  it('статусы 1С: заявка обновляется, «доставлена» — стадия успеха, промежуточные — комментарий', async () => {
    const id = sent(1, 501)
    stageOf[501] = 'C9:PREPARATION'
    await syncOrders(deps)
    const row = (status: 'shipped' | 'delivered') => ({ orderGuid: g(900), externalId: '501', number: 'ЛК-1', status, shipmentDate: '2026-10-14', changedAt: NOW.toISOString() })
    expect(await applyOnecStatuses([row('shipped')], deps)).toBe(1)
    expect(deps.orders.byId(id)).toMatchObject({ status: 'shipped', shipment_date: '2026-10-14' })
    expect(deps.b24.moveDeal).not.toHaveBeenCalled()
    expect(deps.b24.comment).toHaveBeenLastCalledWith(501, 'Статус в 1С: В пути, отгрузка 2026-10-14.')
    await applyOnecStatuses([row('delivered')], deps)
    expect(deps.b24.moveDeal).toHaveBeenCalledWith(501, 'C9:WON')
    // Тот же статус повторно — без лишних комментариев.
    const calls = deps.b24.comment.mock.calls.length
    await applyOnecStatuses([row('delivered')], deps)
    expect(deps.b24.comment.mock.calls.length).toBe(calls)
  })

  it('чужие заказы 1С (не из ЛК) пропускаются; заказ находится и по externalId', async () => {
    const id = sent(1, 501)
    expect(await applyOnecStatuses([{ orderGuid: g(999), externalId: '777', number: 'X', status: 'shipped', shipmentDate: null, changedAt: NOW.toISOString() }], deps)).toBe(0)
    expect(await applyOnecStatuses([{ orderGuid: g(901), externalId: '501', number: 'ЛК-2', status: 'cancelled', shipmentDate: null, changedAt: NOW.toISOString() }], deps)).toBe(1)
    expect(deps.orders.byId(id)).toMatchObject({ status: 'cancelled', onec_order_guid: g(901) })
    expect(deps.b24.moveDeal).toHaveBeenCalledWith(501, 'C9:LOSE')
  })

  it('дата доставки — день рейса по Минску; без рейса — завтра по Минску', () => {
    expect(deliveryDateFor('2026-10-13T22:30:00.000Z', NOW)).toBe('2026-10-14')
    expect(deliveryDateFor(null, new Date('2026-10-12T22:00:00Z'))).toBe('2026-10-14')
  })
})
