import { describe, expect, it } from 'vitest'
import { createMockState, handleMockRequest, ORDER_TIMELINE, type MockRequest } from '../server/mocks/onec/mock'
import { generateSeed } from '../server/mocks/onec/seed'

const T0 = Date.parse('2026-10-11T10:00:00Z')
const auth = 'Bearer t'
const req = (r: Partial<MockRequest>): MockRequest => ({ method: 'GET', path: '/', query: {}, authorization: auth, ...r })

describe('данные мока', () => {
  it('один seed — одни данные; объёмы как в docs/spec.md §6', () => {
    const a = generateSeed(1)
    const b = generateSeed(1)
    expect(a.items.map(i => i.guid)).toEqual(b.items.map(i => i.guid))
    expect(generateSeed(2).items[0]!.guid).not.toBe(a.items[0]!.guid)
    expect([a.clients.length, a.priceTypes.length, a.warehouses.length, a.sections.length, a.items.length]).toEqual([5, 3, 2, 12, 500])
  })

  it('аналоги — двусторонние, того же раздела, другого бренда', () => {
    const { items } = generateSeed(1)
    const byGuid = new Map(items.map(i => [i.guid, i]))
    for (const item of items) {
      for (const g of item.analogs) {
        const peer = byGuid.get(g)!
        expect(peer.analogs).toContain(item.guid)
        expect(peer.sectionGuid).toBe(item.sectionGuid)
        expect(peer.brand).not.toBe(item.brand)
      }
    }
    expect(items.every(i => i.analogs.length > 0)).toBe(true)
  })
})

function orderFor(state: ReturnType<typeof createMockState>, i: number, externalId = 'deal-1') {
  const client = state.data.clients[i]!
  return {
    externalId, clientGuid: client.guid, contractGuid: client.contract!.guid,
    deliveryAddressGuid: client.deliveryAddresses[0]!.guid, deliveryDate: '2026-10-13',
    items: [{ itemGuid: state.data.items[0]!.guid, qty: 1, price: 1 }],
  }
}

describe('поведение мока', () => {
  it('прайс: каждый вид цен × товар, цена = базовая × коэффициент; заказ — с фактом цены и резерва', () => {
    const state = createMockState('t')
    const { data } = state
    const res = handleMockRequest(state, req({ path: '/prices' }), T0)
    const { items: rows, nextPage } = res.body as { items: { priceTypeGuid: string, itemGuid: string, price: number }[], nextPage: number | null }
    expect(nextPage).toBe(2)
    const item = data.items[7]!
    for (const pt of data.priceTypes) {
      const all = [...rows, ...(handleMockRequest(state, req({ path: '/prices', query: { page: '2' } }), T0).body as { items: typeof rows }).items, ...(handleMockRequest(state, req({ path: '/prices', query: { page: '3' } }), T0).body as { items: typeof rows }).items]
      const row = all.find(r => r.priceTypeGuid === pt.guid && r.itemGuid === item.guid)!
      expect(row.price).toBeCloseTo(Math.round(data.basePrice.get(item.guid)! * pt.coefficient * 100) / 100, 2)
    }
    const order = orderFor(state, 0)
    const created = handleMockRequest(state, req({ method: 'POST', path: '/order', body: { ...order, items: [{ ...order.items[0], qty: 100_000 }] } }), T0)
    const fact = (created.body as { items: { reserved: number, price: number }[] }).items[0]!
    expect(fact.reserved).toBeLessThan(100_000)
  })

  it('остатки меняются между запросами, и changedSince видит именно их', () => {
    const state = createMockState('t')
    handleMockRequest(state, req({ path: '/stock' }), T0)
    const res = handleMockRequest(state, req({ path: '/stock', query: { changedSince: new Date(T0 + 1).toISOString() } }), T0 + 1000)
    const { items } = res.body as { items: { changedAt: string }[] }
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThanOrEqual(5)
    expect(items.every(i => i.changedAt === new Date(T0 + 1000).toISOString())).toBe(true)
  })

  it('заказ сам проходит статусы по времени; отмена двигает changedAt', () => {
    const state = createMockState('t')
    const client = state.data.clients[0]!
    const body = {
      externalId: 'deal-1', clientGuid: client.guid, contractGuid: client.contract!.guid,
      deliveryAddressGuid: client.deliveryAddresses[0]!.guid, deliveryDate: '2026-10-13',
      items: [{ itemGuid: state.data.items[0]!.guid, qty: 1, price: 1 }],
    }
    const created = handleMockRequest(state, req({ method: 'POST', path: '/order', body }), T0)
    expect(created.status).toBe(201)
    const statusAt = (t: number) => (handleMockRequest(state, req({ path: '/orders/status' }), t).body as { items: { status: string }[] }).items[0]!.status
    for (const [status, sec] of ORDER_TIMELINE) expect(statusAt(T0 + sec * 1000)).toBe(status)

    const orderGuid = (created.body as { orderGuid: string }).orderGuid
    handleMockRequest(state, req({ method: 'POST', path: '/_admin/cancel', body: { orderGuid } }), T0 + 700_000)
    const after = handleMockRequest(state, req({ path: '/orders/status', query: { changedSince: new Date(T0 + 650_000).toISOString() } }), T0 + 800_000)
    expect((after.body as { items: { status: string }[] }).items.map(i => i.status)).toEqual(['cancelled'])
  })

  it('failNext отвечает 503 заданное число раз, потом снова 200', () => {
    const state = createMockState('t')
    handleMockRequest(state, req({ method: 'POST', path: '/_admin/mode', body: { failNext: 2 } }), T0)
    const codes = [1, 2, 3].map(() => handleMockRequest(state, req({ path: '/clients' }), T0).status)
    expect(codes).toEqual([503, 503, 200])
  })

  it('новый клиент из _admin/client виден по changedSince, reset возвращает сид', () => {
    const state = createMockState('t')
    handleMockRequest(state, req({ method: 'POST', path: '/_admin/client', body: { name: 'ООО «Новичок»' } }), T0)
    const fresh = handleMockRequest(state, req({ path: '/clients', query: { changedSince: new Date(T0 - 1).toISOString() } }), T0)
    expect((fresh.body as { items: { name: string }[] }).items.map(c => c.name)).toEqual(['ООО «Новичок»'])
    handleMockRequest(state, req({ method: 'POST', path: '/_admin/reset' }), T0)
    expect(state.data.clients).toHaveLength(5)
  })

  it('без токена мока закрыт, и управление — тоже', () => {
    const state = createMockState('t')
    expect(handleMockRequest(state, req({ authorization: null, path: '/clients' }), T0).status).toBe(401)
    expect(handleMockRequest(state, req({ authorization: null, method: 'POST', path: '/_admin/reset' }), T0).status).toBe(401)
    expect(handleMockRequest(createMockState(''), req({ authorization: 'Bearer ', path: '/clients' }), T0).status).toBe(401)
  })
})

describe('заказы и страницы мока', () => {

  it('чужой externalId — 409, а не чужой заказ', () => {
    const state = createMockState('t')
    expect(handleMockRequest(state, req({ method: 'POST', path: '/order', body: orderFor(state, 0) }), T0).status).toBe(201)
    const res = handleMockRequest(state, req({ method: 'POST', path: '/order', body: orderFor(state, 1) }), T0)
    expect(res.status).toBe(409)
  })

  it('договор или адрес не этого клиента — 400', () => {
    const state = createMockState('t')
    const body = { ...orderFor(state, 0), contractGuid: state.data.clients[1]!.contract!.guid }
    expect(handleMockRequest(state, req({ method: 'POST', path: '/order', body }), T0).status).toBe(400)
  })

  it('последняя полная страница — nextPage: null, без пустой страницы следом', () => {
    const state = createMockState('t')
    const res = handleMockRequest(state, req({ path: '/clients', query: { pageSize: '5' } }), T0)
    expect((res.body as { items: unknown[], nextPage: unknown })).toMatchObject({ nextPage: null })
    expect((res.body as { items: unknown[] }).items).toHaveLength(5)
  })
})

describe('мок 1С: демо-клиенты и витрина algena.by', () => {
  it('GUID из ONEC_MOCK_CLIENTS получает договор и адрес, остальной сид не меняется', () => {
    const guid = '3fbebdf8-bd8b-11f1-b86f-00155d008d05'
    const base = generateSeed(1)
    const withDemo = generateSeed(1, [guid])
    const demo = withDemo.clients.find(c => c.guid === guid)!
    expect(withDemo.contracts.some(c => c.guid === demo.contract?.guid)).toBe(true)
    expect(demo.deliveryAddresses).toHaveLength(1)
    expect(withDemo.items.map(i => i.guid)).toEqual(base.items.map(i => i.guid))
  })

  it('первые товары «Сухих смесей» — с algena.by: имя, цена, картинка', () => {
    const { items, basePrice } = generateSeed(1)
    const first = items[0]!
    expect(first.name).toContain('CemTop')
    expect(basePrice.get(first.guid)).toBe(18.2)
    expect(items.filter(i => i.images.length > 0).length).toBe(6)
  })
})
