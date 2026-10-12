import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { migrate } from '../server/db/sqlite'
import { createCatalogStore } from '../server/utils/catalog'
import { createClientStore } from '../server/utils/clients'
import { createOrderStore, parseCartLines, quoteCart, submitOrder, type SubmitDeps } from '../server/utils/orders'
import { createB24Orders, DEAL_ORIGINATOR, nearestTrip, type Trip } from '../server/services/b24Orders'
import { addressLine, isValidQty, neutralizeBb, normalizeQty } from '../shared/cart'
import type { ClientT, ItemT, PriceT } from '../shared/onec/schemas'

const at = '2026-10-01T00:00:00Z'
const g = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const item = (n: number, over: Partial<ItemT> = {}): ItemT => ({
  guid: g(n), sku: `SKU-${n}`, name: `Товар ${n}`, sectionGuid: g(900), brand: 'Acme', unit: 'шт', packQty: 1, minQty: 1,
  description: '', properties: {}, images: [], analogs: [], changedAt: at, deleted: false, ...over,
})
const client = (over: Partial<ClientT> = {}): ClientT => ({
  guid: g(100), name: 'ООО «Клиент»', unp: '1', address: '', city: 'Минск', managerEmail: '', contractGuid: g(200),
  deliveryAddresses: [{ guid: g(300), city: 'Минск', address: 'ул. Строителей, 1' }], changedAt: at, deleted: false, ...over,
})
const REQ = '11111111-1111-4111-8111-111111111111'
const ok = { status: 'ok' as const, clientGuid: g(100) }
const priceOf = (guid: string, price: number): PriceT => ({ itemGuid: guid, price, currency: 'BYN', vatRate: 20 })

describe('правила корзины', () => {
  it('количество — кратно упаковке и не меньше минимума', () => {
    expect(normalizeQty(7, 5, 5)).toBe(10)
    expect(normalizeQty(1, 1, 3)).toBe(3)
    expect(normalizeQty(0.3, 0.1, 0.1)).toBe(0.3)
    expect(isValidQty(10, 5, 5)).toBe(true)
    expect(isValidQty(7, 5, 5)).toBe(false)
    expect(isValidQty(0.3, 0.1, 0.1)).toBe(true)
    expect(isValidQty(Number.NaN, 1, 1)).toBe(false)
  })

  it('разбор корзины: мусор отбрасывается, повторы складываются', () => {
    expect(parseCartLines({ items: [{ guid: g(1).toUpperCase(), qty: 2 }, { guid: g(1), qty: 3 }, { guid: 'x', qty: 1 }, { guid: g(2), qty: -1 }, { guid: g(3), qty: 'a' }] }))
      .toEqual([{ guid: g(1), qty: 5 }])
    expect(parseCartLines({ items: 'no' })).toEqual([])
    expect(parseCartLines({ items: Array.from({ length: 500 }, (_, i) => ({ guid: g(i + 1), qty: 1 })) }).length).toBe(200)
  })

  it('адрес одной строкой — без повтора города', () => {
    expect(addressLine('Минск', 'г. Минск, ул. Строителей, 10')).toBe('г. Минск, ул. Строителей, 10')
    expect(addressLine('Минск', 'ул. Строителей, 1')).toBe('Минск, ул. Строителей, 1')
  })

  it('BB-коды комментария клиента обезврежены', () => {
    expect(neutralizeBb('[url=http://x]клик[/url]')).toBe('［url=http://x］клик［/url］')
  })
})

describe('ближайший рейс', () => {
  const trip = (id: number, city: string, cutoff: string, departure: string): Trip => ({ id, city, cutoffAt: cutoff, departureAt: departure })
  const now = new Date('2026-10-12T10:00:00Z')
  it('приём открыт, раньше всех по отсечке, город без регистра и ё', () => {
    const trips = [
      trip(1, 'Минск', '2026-10-12T09:00:00Z', '2026-10-13T08:00:00Z'),
      trip(2, 'минск', '2026-10-14T12:00:00Z', '2026-10-15T08:00:00Z'),
      trip(3, 'Минск', '2026-10-13T12:00:00Z', '2026-10-14T08:00:00Z'),
      trip(4, 'Гомель', '2026-10-12T11:00:00Z', '2026-10-13T08:00:00Z'),
      trip(5, 'Минск', '2026-10-12T12:00:00Z', '2026-10-12T11:00:00Z'),
    ]
    expect(nearestTrip(trips, 'МИНСК', now)?.id).toBe(3)
    expect(nearestTrip(trips, 'Брест', now)).toBeNull()
    expect(nearestTrip([trip(9, 'Мозырь', '2026-10-13T00:00:00Z', '2026-10-13T08:00:00Z')], 'мозырь', now)?.id).toBe(9)
  })
})

describe('заявка', () => {
  let deps: SubmitDeps & { b24: { createDeal: ReturnType<typeof vi.fn>, nearestTrip: ReturnType<typeof vi.fn> } }
  let db: DatabaseSync
  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    migrate(db)
    const store = createCatalogStore(db)
    store.saveCatalog([], [item(1, { packQty: 5, minQty: 5 }), item(2)])
    const clients = createClientStore(db)
    clients.save([client()])
    deps = {
      store, clients, orders: createOrderStore(db),
      b24: { createDeal: vi.fn(async () => 501), nearestTrip: vi.fn(async () => ({ id: 1, city: 'Минск', cutoffAt: '2026-10-13T12:00:00Z', departureAt: '2026-10-14T08:00:00Z' })) },
      prices: vi.fn(async (_c: string, items: string[]) => new Map(items.map(i => [i, priceOf(i, i === g(1) ? 2.5 : 10)]))),
      now: () => new Date('2026-10-12T10:00:00Z'),
    }
  })
  const session = { companyId: 7, contactId: 5 }
  const input = (over = {}) => ({ requestId: REQ, lines: [{ guid: g(1), qty: 10 }, { guid: g(2), qty: 3 }], addressGuid: g(300), comment: 'позвоните [b]заранее[/b]', ...over })

  it('расчёт: цены с сервера, итог, неверная кратность и неизвестный товар — проблемы', async () => {
    const q = await quoteCart([{ guid: g(1), qty: 7 }, { guid: g(2), qty: 2 }, { guid: g(9), qty: 1 }], deps.store, ok, deps.prices)
    expect(q.lines.map(l => l.problem)).toEqual(['bad_qty', null, 'not_found'])
    expect(q.lines[0]!.suggestedQty).toBe(10)
    expect(q.ok).toBe(false)
    const good = await quoteCart([{ guid: g(1), qty: 10 }, { guid: g(2), qty: 3 }], deps.store, ok, deps.prices)
    expect(good).toMatchObject({ ok: true, total: 55, currency: 'BYN' })
  })

  it('без цены договора заявка не уходит', async () => {
    deps.prices = vi.fn(async () => new Map([[g(1), priceOf(g(1), 2.5)]]))
    const r = await submitOrder(session, ok, input(), deps)
    expect(r).toMatchObject({ ok: false, status: 422, error: 'cart_invalid' })
    expect(deps.b24.createDeal).not.toHaveBeenCalled()
  })

  it('уходит сделкой: компания и контакт из сессии, итог с сервера, комментарий обезврежен', async () => {
    const r = await submitOrder(session, ok, input(), deps)
    expect(r).toMatchObject({ ok: true, dealId: 501, deliveryAt: '2026-10-14T08:00:00Z' })
    const deal = deps.b24.createDeal.mock.calls[0]![0]
    expect(deal).toMatchObject({ requestId: REQ, companyId: 7, contactId: 5, total: 55, currency: 'BYN' })
    expect(deal.comments).toContain('［b］заранее［/b］')
    expect(deal.comments).toContain('Ближайший рейс: ср, 14 октября в 11:00')
    expect(deal.rows).toEqual([
      { name: 'Товар 1 (SKU-1)', price: 2.5, qty: 10, unit: 'шт', vatRate: 20 },
      { name: 'Товар 2 (SKU-2)', price: 10, qty: 3, unit: 'шт', vatRate: 20 },
    ])
    expect(deps.orders.list(7)).toMatchObject([{ status: 'sent', dealId: 501, total: 55, address: 'Минск, ул. Строителей, 1' }])
  })

  it('повтор с тем же requestId — та же заявка, вторая сделка не создаётся', async () => {
    const a = await submitOrder(session, ok, input(), deps)
    const b = await submitOrder(session, ok, input(), deps)
    expect(b).toEqual(a)
    expect(deps.b24.createDeal).toHaveBeenCalledTimes(1)
    expect(deps.orders.list(7).length).toBe(1)
  })

  it('сбой CRM: черновик остаётся, повтор дошлёт ту же заявку', async () => {
    deps.b24.createDeal.mockRejectedValueOnce(new Error('503'))
    expect(await submitOrder(session, ok, input(), deps)).toMatchObject({ ok: false, status: 503 })
    expect(deps.orders.list(7)[0]).toMatchObject({ status: 'pending', dealId: null })
    expect(await submitOrder(session, ok, input(), deps)).toMatchObject({ ok: true, dealId: 501 })
    expect(deps.orders.list(7).length).toBe(1)
  })

  it('чужой requestId не открывает чужую заявку; «Мои заявки» — только своей компании', async () => {
    await submitOrder(session, ok, input(), deps)
    expect(await submitOrder({ companyId: 8, contactId: 6 }, ok, input(), deps)).toMatchObject({ ok: false, status: 400 })
    expect(deps.orders.list(8)).toEqual([])
  })

  it('адрес — только из адресов своего клиента; нет договора — 409; CRM недоступна — 503', async () => {
    expect(await submitOrder(session, ok, input({ addressGuid: g(301) }), deps)).toMatchObject({ error: 'bad_address' })
    expect(await submitOrder(session, { status: 'no-contract' }, input(), deps)).toMatchObject({ status: 409, error: 'no_contract' })
    expect(await submitOrder(session, { status: 'unavailable' }, input(), deps)).toMatchObject({ status: 503 })
    createClientStore(db).save([client({ contractGuid: null })])
    expect(await submitOrder(session, ok, input(), deps)).toMatchObject({ status: 409, error: 'no_contract' })
  })

  it('рейс не нашёлся или «Рейсы» недоступны — заявка всё равно уходит', async () => {
    deps.b24.nearestTrip.mockRejectedValueOnce(new Error('503'))
    expect(await submitOrder(session, ok, input(), deps)).toMatchObject({ ok: true, deliveryAt: null })
    expect(deps.b24.createDeal.mock.calls[0]![0].comments).toContain('уточните дату')
  })

  it('кривой requestId и слишком длинный комментарий — 400', async () => {
    expect(await submitOrder(session, ok, input({ requestId: 'x' }), deps)).toMatchObject({ status: 400 })
    expect(await submitOrder(session, ok, input({ comment: 'x'.repeat(2001) }), deps)).toMatchObject({ status: 400 })
    expect(await submitOrder(session, ok, input({ lines: [] }), deps)).toMatchObject({ status: 400 })
  })
})

describe('сделка в CRM', () => {
  function fake(existing: { ID: string, ORIGIN_ID: string }[] = []) {
    const calls: { method: string, params: Record<string, unknown> }[] = []
    const call = async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params })
      if (method === 'crm.deal.list') return existing
      if (method === 'crm.category.list') return { categories: [{ id: 3, name: 'Другая' }, { id: 9, name: 'Заявки ЛК' }] }
      if (method === 'crm.deal.add') return 77
      if (method === 'crm.deal.productrows.set') return true
      if (method === 'crm.activity.todo.add') return { id: 15 }
      throw new Error(method)
    }
    return { call, calls }
  }
  const deal = { requestId: REQ, companyId: 7, contactId: 5, title: 'T', comments: 'C', total: 10, currency: 'BYN', rows: [{ name: 'A', price: 10, qty: 1, unit: 'шт', vatRate: 20 }] }

  it('новая: воронка «Заявки ЛК», метка источника, товары с НДС в цене', async () => {
    const f = fake()
    expect(await createB24Orders(f.call).createDeal(deal)).toBe(77)
    expect(f.calls.find(c => c.method === 'crm.deal.add')!.params.fields).toMatchObject({ CATEGORY_ID: 9, COMPANY_ID: 7, CONTACT_IDS: [5], ORIGINATOR_ID: DEAL_ORIGINATOR, ORIGIN_ID: REQ })
    expect(f.calls.find(c => c.method === 'crm.deal.productrows.set')!.params).toMatchObject({ id: 77, rows: [{ PRODUCT_NAME: 'A', PRICE: 10, TAX_RATE: 20, TAX_INCLUDED: 'Y' }] })
  })

  it('повтор находит прежнюю сделку по ORIGIN_ID и не создаёт новую; чужой ORIGIN_ID не считается', async () => {
    const f = fake([{ ID: '55', ORIGIN_ID: REQ }])
    expect(await createB24Orders(f.call).createDeal(deal)).toBe(55)
    expect(f.calls.some(c => c.method === 'crm.deal.add')).toBe(false)
    const other = fake([{ ID: '56', ORIGIN_ID: 'другой' }])
    expect(await createB24Orders(other.call).createDeal(deal)).toBe(77)
  })

  it('звонок — дело на компании ответственному', async () => {
    const f = fake()
    expect(await createB24Orders(f.call).requestCallback({ companyId: 7, responsibleId: 3, contactLabel: 'Иван', now: new Date('2026-10-12T10:00:00Z') })).toBe(15)
    expect(f.calls[0]!.params).toMatchObject({ ownerTypeId: 4, ownerId: 7, responsibleId: 3, deadline: '2026-10-12T11:00:00.000Z' })
  })
})
