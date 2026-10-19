/**
 * Доставка из 1С (решение владельца 2026-10-19): график по регионам и задания на перевозку
 * только читаются — база ЛК, мок, вкладка «Ближайшие доставки» в Битрикс24.
 */
import { describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../server/db/sqlite'
import { createDeliveryStore } from '../server/utils/delivery'
import { deliveriesWindow, readDeliveries } from '../server/utils/deliveriesTab'
import { createClientStore } from '../server/utils/clients'
import { nextDelivery, scheduleFromOnec } from '../shared/delivery'
import { createMockState, handleMockRequest, ORDER_TIMELINE, type MockRequest } from '../server/mocks/onec/mock'
import type { DeliveryScheduleT, TripT } from '../shared/onec/schemas'

const g = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const brest: DeliveryScheduleT = { regionGuid: g(1).toUpperCase(), regionName: 'Брест', weekdays: [2, 5], cutoffDaysBefore: 1, cutoffTime: '16:00', arrivalFrom: '10:00', arrivalTo: '14:00', exceptions: [] }
const trip = (over: Partial<TripT> = {}): TripT => ({
  guid: g(10), number: 'ЦБ-00001048', status: 'loading', plannedStart: '2026-10-20T08:00:00.000+03:00', plannedEnd: null, actualStart: null, actualEnd: null,
  vehicle: 'АМ 3634-1', regionGuids: [g(1)], orders: [{ orderGuid: g(20), number: '00ЦБ-000224', clientGuid: g(30) }], changedAt: '2026-10-19T09:00:00.000Z', deleted: false, ...over,
})

describe('график доставки из 1С', () => {
  it('ближайший рейс считается по бизнес-региону клиента, а не по городу', () => {
    const s = scheduleFromOnec(brest)
    expect(s).toMatchObject({ region: g(1), cutoffMinutes: 16 * 60, arrivalFromMinutes: 600, arrivalToMinutes: 840 })
    // Понедельник 19.10.2026 12:00 по Минску: до отсечки в 16:00 — рейс во вторник.
    expect(nextDelivery([s], g(1), new Date('2026-10-19T09:00:00Z'))?.date).toBe('2026-10-20')
    expect(nextDelivery([s], null, new Date('2026-10-19T09:00:00Z'))).toBeNull()
    expect(nextDelivery([s], g(2), new Date('2026-10-19T09:00:00Z'))).toBeNull()
  })

  it('график приходит целиком: регион, пропавший из ответа, удаляется', () => {
    const store = createDeliveryStore(openDatabase(':memory:'))
    store.saveSchedules([brest, { ...brest, regionGuid: g(2), regionName: 'Гомель' }])
    store.saveSchedules([brest])
    expect(store.schedules().map(s => s.region)).toEqual([g(1)])
  })
})

describe('задания на перевозку в базе ЛК', () => {
  it('окно недели, удалённые скрыты, имя клиента и региона — из базы', () => {
    const db = openDatabase(':memory:')
    const store = createDeliveryStore(db)
    store.saveSchedules([brest])
    createClientStore(db).save([{ guid: g(30), name: 'ООО «Клиент»', unp: '', address: '', city: 'Брест', region: { guid: g(1), name: 'Брест' }, shipmentBlocked: true, managerEmail: '', contract: null, deliveryAddresses: [], changedAt: '2026-10-01T00:00:00Z', deleted: false }])
    store.saveTrips([trip(), trip({ guid: g(11), deleted: true }), trip({ guid: g(12), plannedStart: '2026-11-30T08:00:00.000+03:00' })])
    const { from, to } = deliveriesWindow(new Date('2026-10-19T21:30:00Z'))
    expect(from.toISOString()).toBe('2026-10-19T21:00:00.000Z')
    const up = store.upcoming(from, to)
    expect(up.map(t => t.guid)).toEqual([g(10)])
    expect(up[0]).toMatchObject({ regions: ['Брест'], orders: [{ number: '00ЦБ-000224', clientName: 'ООО «Клиент»' }] })
    expect(createClientStore(db).get(g(30))).toMatchObject({ regionGuid: g(1), shipmentBlocked: true })
    expect(store.trip(g(10))).toMatchObject({ status: 'loading' })
  })
})

describe('вкладка «Ближайшие доставки»', () => {
  const upcoming = vi.fn(() => [])
  it('только с портала, где стоит приложение, и с живым токеном сотрудника', async () => {
    const userCall = vi.fn(async () => ({ ID: '5' }))
    expect((await readDeliveries({ domain: 'evil.by', authId: 't' }, { allowedHosts: ['crm.algena.by'], userCall, upcoming })).status).toBe(403)
    expect(userCall).not.toHaveBeenCalled()
    const failing = vi.fn(async () => { throw new Error('expired_token') })
    expect((await readDeliveries({ domain: 'https://crm.algena.by', authId: 't' }, { allowedHosts: ['crm.algena.by'], userCall: failing, upcoming })).status).toBe(403)
    const ok = await readDeliveries({ domain: 'https://crm.algena.by', authId: 't' }, { allowedHosts: ['crm.algena.by'], userCall, upcoming })
    expect(ok.status).toBe(200)
    expect(userCall).toHaveBeenCalledWith('crm.algena.by', 't', 'user.current', {})
  })
})

describe('мок 1С: график и рейсы', () => {
  const req = (r: Partial<MockRequest>): MockRequest => ({ method: 'GET', path: '/', query: {}, authorization: 'Bearer t', ...r })
  it('собранный заказ попадает в рейс своего региона, статус рейса идёт за заказом', () => {
    const state = createMockState('t')
    const T0 = Date.parse('2026-10-19T08:00:00Z')
    const client = state.data.clients[0]!
    const body = { externalId: 'd1', clientGuid: client.guid, contractGuid: client.contract!.guid, deliveryAddressGuid: client.deliveryAddresses[0]!.guid, deliveryDate: '2026-10-20', items: [{ itemGuid: state.data.items[0]!.guid, qty: 1, price: 1 }] }
    const created = handleMockRequest(state, req({ method: 'POST', path: '/order', body }), T0).body as { orderGuid: string }
    const statusAt = (t: number) => (handleMockRequest(state, req({ path: '/orders/status' }), t).body as { items: { tripGuid: string | null }[] }).items[0]!.tripGuid
    expect(statusAt(T0)).toBeNull()
    const assembled = T0 + ORDER_TIMELINE.find(([s]) => s === 'assembled')![1] * 1000
    const tripGuid = statusAt(assembled)
    expect(tripGuid).not.toBeNull()
    const trips = (handleMockRequest(state, req({ path: '/trips' }), assembled).body as { items: TripT[] }).items
    const mine = trips.find(t => t.guid === tripGuid)!
    expect(mine).toMatchObject({ status: 'loading', regionGuids: [client.region!.guid] })
    expect(mine.orders.map(o => o.orderGuid)).toEqual([created.orderGuid])
    const delivered = T0 + ORDER_TIMELINE.at(-1)![1] * 1000
    expect((handleMockRequest(state, req({ path: '/trips' }), delivered).body as { items: TripT[] }).items.find(t => t.guid === tripGuid)!.status).toBe('closed')
    const schedule = (handleMockRequest(state, req({ path: '/delivery-schedule' }), T0).body as { items: DeliveryScheduleT[] }).items
    expect(schedule.map(s => s.regionGuid)).toContain(client.region!.guid)
  })
})

describe('рейс заказа из статусов 1С', () => {
  it('рейс записывается и без смены статуса: 1С может перенести заказ в другой рейс', async () => {
    const { applyOnecStatuses } = await import('../server/utils/orderSync')
    const setTrip = vi.fn(() => true)
    const applyStatus = vi.fn()
    const orders = { findForStatus: () => ({ id: 7, status: 'assembled' }), setTrip, applyStatus } as never
    const row = { orderGuid: g(20), externalId: '1', number: 'ЗК-1', status: 'assembled' as const, shipmentDate: null, tripGuid: g(10), changedAt: '2026-10-19T09:00:00.000Z' }
    expect(applyOnecStatuses([row], { orders })).toBe(0)
    expect(setTrip).toHaveBeenCalledWith(7, g(10))
    expect(applyStatus).not.toHaveBeenCalled()
  })
})
