import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { migrate } from '../server/db/sqlite'
import { createCatalogStore } from '../server/utils/catalog'
import { createClientStore } from '../server/utils/clients'
import { createOrderStore, parseCartLines, quoteCart, SENDING_STALE_MS, submitOrder, type SubmitDeps } from '../server/utils/orders'
import { createB24Orders, DEAL_ORIGINATOR } from '../server/services/b24Orders'
import { createRateLimiter } from '../server/utils/rateLimit'
import { formatSlot, nextDelivery, parseDates, parseTime, parseWeekdays, type TripSchedule } from '../shared/delivery'
import { addressLine, isValidQty, neutralizeBb, normalizeQty, roundQty } from '../shared/cart'
import type { ClientT, ItemT, PriceT } from '../shared/onec/schemas'

const at = '2026-10-01T00:00:00Z'
const g = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const item = (n: number, over: Partial<ItemT> = {}): ItemT => ({
  guid: g(n), sku: `SKU-${n}`, name: `Товар ${n}`, sectionGuid: g(900), brand: 'Acme', unit: 'шт', packQty: 1, minQty: 1,
  description: '', properties: {}, images: [], analogs: [], changedAt: at, deleted: false, ...over,
})
const client = (over: Partial<ClientT> = {}): ClientT => ({
  guid: g(100), name: 'ООО «Клиент»', unp: '1', address: '', city: 'Минск', region: { guid: g(400), name: 'Минск' }, shipmentBlocked: false, managerEmail: '', contract: { guid: g(200), number: 'ОПТ-1', date: '2026-01-01', priceTypeGuid: g(201), paymentDelayDays: 0, creditLimit: 0, debt: 0, currency: 'BYN' },
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
    // Целые тысячные: большое количество с дробной упаковкой не получает лишнюю упаковку.
    expect(normalizeQty(999999.999, 0.001, 0.001)).toBe(999999.999)
    expect(roundQty(0.1 + 0.2)).toBe(0.3)
  })

  it('разбор корзины: мусор отбрасывается, повторы складываются', () => {
    expect(parseCartLines({ items: [{ guid: g(1).toUpperCase(), qty: 2 }, { guid: g(1), qty: 3 }, { guid: 'x', qty: 1 }, { guid: g(2), qty: -1 }, { guid: g(3), qty: 'a' }] }))
      .toEqual([{ guid: g(1), qty: 5 }])
    expect(parseCartLines({ items: 'no' })).toEqual([])
    expect(parseCartLines({ items: Array.from({ length: 500 }, (_, i) => ({ guid: g(i + 1), qty: 1 })) }).length).toBe(200)
    expect(parseCartLines({ items: [{ guid: g(1), qty: 1e6 + 1 }] })).toEqual([])
    expect(parseCartLines({ items: [{ guid: g(1), qty: 0.1 }, { guid: g(1), qty: 0.2 }] })).toEqual([{ guid: g(1), qty: 0.3 }])
  })

  it('адрес одной строкой — без повтора города', () => {
    expect(addressLine('Минск', 'г. Минск, ул. Строителей, 10')).toBe('г. Минск, ул. Строителей, 10')
    expect(addressLine('Минск', 'ул. Строителей, 1')).toBe('Минск, ул. Строителей, 1')
  })

  it('BB-коды комментария клиента обезврежены', () => {
    expect(neutralizeBb('[url=http://x]клик[/url]')).toBe('［url=http://x］клик［/url］')
  })
})

describe('расписание рейсов', () => {
  const minsk: TripSchedule = { region: 'Минск', weekdays: [2, 5], cutoffDaysBefore: 1, cutoffMinutes: 16 * 60, arrivalFromMinutes: 10 * 60, arrivalToMinutes: 14 * 60, exceptions: [] }
  // 2026-10-12 — понедельник. Время по Минску = UTC+3.
  const at = (iso: string) => new Date(iso)

  it('разбор полей «Рейсов»', () => {
    expect(parseWeekdays('пн, Ср; пятница 9 7')).toEqual([1, 3, 5, 7])
    expect(parseTime('16:00')).toBe(960)
    expect(parseTime('9.30')).toBe(570)
    expect(parseTime('25:00')).toBeNull()
    expect(parseDates('2026-11-07, 25.12.2026 мусор')).toEqual(['2026-11-07', '2026-12-25'])
  })

  it('до отсечки — ближайший рейс; после — следующий', () => {
    // Вторник 13-го, отсечка — пн 12-го 16:00 по Минску = 13:00 UTC.
    expect(nextDelivery([minsk], 'минск', at('2026-10-12T12:59:00Z'))).toMatchObject({ date: '2026-10-13', arrivalFrom: '2026-10-13T07:00:00.000Z', arrivalTo: '2026-10-13T11:00:00.000Z', cutoffAt: '2026-10-12T13:00:00.000Z' })
    expect(nextDelivery([minsk], 'Минск', at('2026-10-12T13:00:00Z'))?.date).toBe('2026-10-16')
  })

  it('исключение пропускает рейс; другой город и пустое расписание — null', () => {
    expect(nextDelivery([{ ...minsk, exceptions: ['2026-10-13'] }], 'Минск', at('2026-10-12T08:00:00Z'))?.date).toBe('2026-10-16')
    expect(nextDelivery([minsk], 'Брест', at('2026-10-12T08:00:00Z'))).toBeNull()
    expect(nextDelivery([{ ...minsk, weekdays: [] }], 'Минск', at('2026-10-12T08:00:00Z'))).toBeNull()
  })

  it('город — без регистра и с ё = е; из двух расписаний — раньше приезжающее', () => {
    const fast = { ...minsk, region: 'Солигорск', weekdays: [4], cutoffDaysBefore: 0 }
    const slow = { ...minsk, region: 'Солигорск', weekdays: [6] }
    expect(nextDelivery([slow, fast], 'солигорск', at('2026-10-12T08:00:00Z'))?.date).toBe('2026-10-15')
    expect(nextDelivery([{ ...minsk, region: 'Берёза' }], 'береза', at('2026-10-12T08:00:00Z'))?.date).toBe('2026-10-13')
  })

  it('поздний вечер по Минску — уже следующий день, а не по UTC', () => {
    // 23:30 по Минску вт 13-го = 20:30 UTC: рейс «в тот же день» с отсечкой 0 дней уже недоступен.
    const sameDay = { ...minsk, weekdays: [2, 3], cutoffDaysBefore: 0, cutoffMinutes: 23 * 60 + 59 }
    expect(nextDelivery([sameDay], 'Минск', at('2026-10-13T20:30:00Z'))?.date).toBe('2026-10-13')
    expect(nextDelivery([sameDay], 'Минск', at('2026-10-13T21:00:00Z'))?.date).toBe('2026-10-14')
  })

  it('подпись как в спецификации', () => {
    expect(formatSlot({ arrivalFrom: '2026-10-16T07:00:00.000Z', arrivalTo: '2026-10-16T11:00:00.000Z' })).toBe('пт, 16 октября, 10:00–14:00')
  })
})

describe('лимит частоты', () => {
  it('резервирует сразу, возвращается при отказе, окно скользит', () => {
    let t = 0
    const l = createRateLimiter(2, 1000, () => t)
    expect([l.take('a'), l.take('a'), l.take('a')]).toEqual([true, true, false])
    expect(l.take('b')).toBe(true)
    l.release('a')
    expect(l.take('a')).toBe(true)
    t = 1001
    expect(l.take('a')).toBe(true)
  })
})

describe('заявка', () => {
  let deps: SubmitDeps & { b24: { createDeal: ReturnType<typeof vi.fn> }, schedules: ReturnType<typeof vi.fn> }
  let db: DatabaseSync
  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    migrate(db)
    const store = createCatalogStore(db)
    store.saveCatalog([], [item(1, { packQty: 5, minQty: 5 }), item(2), item(3)])
    store.saveStock([1, 2].map(n => ({ itemGuid: g(n), warehouseGuid: g(500), warehouseName: 'Склад', available: 100, changedAt: at })))
    const clients = createClientStore(db)
    clients.save([client()])
    deps = {
      store, clients, orders: createOrderStore(db),
      b24: { createDeal: vi.fn(async () => 501) },
      schedules: vi.fn(async () => [{ region: g(400), weekdays: [3], cutoffDaysBefore: 1, cutoffMinutes: 16 * 60, arrivalFromMinutes: 10 * 60, arrivalToMinutes: 14 * 60, exceptions: [] }]),
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

  it('товара нет в наличии — строка с проблемой, заявку не пускаем', async () => {
    const q = await quoteCart([{ guid: g(2), qty: 1 }, { guid: g(3), qty: 1 }], deps.store, ok, deps.prices)
    expect(q.lines.map(l => l.problem)).toEqual([null, 'out_of_stock'])
    expect(q.ok).toBe(false)
  })

  it('ORDER_STOCK_MODE: stock — не больше наличия, over — больше можно, any — и то, чего нет', async () => {
    const strict = await quoteCart([{ guid: g(1), qty: 110 }], deps.store, ok, deps.prices)
    expect(strict.lines[0]).toMatchObject({ problem: 'over_stock', suggestedQty: 100 })
    expect(strict.ok).toBe(false)
    expect((await quoteCart([{ guid: g(1), qty: 100 }], deps.store, ok, deps.prices)).lines[0]!.problem).toBeNull()
    expect((await quoteCart([{ guid: g(1), qty: 110 }], deps.store, ok, deps.prices, 'over')).lines[0]!.problem).toBeNull()
    expect((await quoteCart([{ guid: g(3), qty: 1 }], deps.store, ok, deps.prices, 'over')).lines[0]!.problem).toBe('out_of_stock')
    expect((await quoteCart([{ guid: g(3), qty: 1 }], deps.store, ok, deps.prices, 'any')).lines[0]!.problem).not.toBe('out_of_stock')
  })

  it('без цены договора заявка не уходит', async () => {
    deps.prices = vi.fn(async () => new Map([[g(1), priceOf(g(1), 2.5)]]))
    const r = await submitOrder(session, ok, input(), deps)
    expect(r).toMatchObject({ ok: false, status: 422, error: 'cart_invalid' })
    expect(deps.b24.createDeal).not.toHaveBeenCalled()
  })

  it('уходит сделкой: компания и контакт из сессии, итог с сервера, комментарий обезврежен', async () => {
    const r = await submitOrder(session, ok, input(), deps)
    expect(r).toMatchObject({ ok: true, dealId: 501, deliveryFrom: '2026-10-14T07:00:00.000Z', deliveryTo: '2026-10-14T11:00:00.000Z' })
    const deal = deps.b24.createDeal.mock.calls[0]![0]
    expect(deal).toMatchObject({ requestId: REQ, companyId: 7, contactId: 5, total: 55, currency: 'BYN' })
    expect(deal.comments).toContain('［b］заранее［/b］')
    expect(deal.comments).toContain('Ближайший рейс: ср, 14 октября, 10:00–14:00')
    expect(deal.rows).toEqual([
      { name: 'Товар 1 (SKU-1)', price: 2.5, qty: 10, unit: 'шт', vatRate: 20 },
      { name: 'Товар 2 (SKU-2)', price: 10, qty: 3, unit: 'шт', vatRate: 20 },
    ])
    expect(deps.orders.list(7)).toMatchObject([{ status: 'sent', total: 55, address: 'Минск, ул. Строителей, 1' }])
  })

  it('сделка подписана названием компании из CRM, а не именем клиента из 1С (#77)', async () => {
    deps.companyTitle = vi.fn(async (id: number) => (id === 7 ? 'Рога И Копыта' : null))
    await submitOrder(session, ok, input(), deps)
    expect(deps.b24.createDeal.mock.calls[0]![0].title).toBe('Заявка ЛК №1: Рога И Копыта')
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
    expect(deps.orders.list(7)[0]).toMatchObject({ status: 'pending' })
    expect((db.prepare('SELECT error FROM order_request').get() as { error: string }).error).toBe('Error')
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
    createClientStore(db).save([client({ contract: null })])
    expect(await submitOrder(session, ok, input(), deps)).toMatchObject({ status: 409, error: 'no_contract' })
  })

  it('рейс не нашёлся или «Рейсы» недоступны — заявка всё равно уходит', async () => {
    deps.schedules.mockRejectedValueOnce(new Error('503'))
    expect(await submitOrder(session, ok, input(), deps)).toMatchObject({ ok: true, deliveryFrom: null })
    expect(deps.b24.createDeal.mock.calls[0]![0].comments).toContain('согласуйте дату')
  })

  it('два одновременных запроса с одним requestId — одна сделка', async () => {
    let release!: (v: number) => void
    deps.b24.createDeal.mockImplementationOnce(() => new Promise<number>((r) => { release = r }))
    const first = submitOrder(session, ok, input(), deps)
    await new Promise(r => setTimeout(r, 0))
    expect(await submitOrder(session, ok, input(), deps)).toMatchObject({ ok: false, status: 409, error: 'in_progress' })
    release(501)
    expect(await first).toMatchObject({ ok: true, dealId: 501 })
    expect(deps.b24.createDeal).toHaveBeenCalledTimes(1)
  })

  it('зависшая попытка протухает: повтор после SENDING_STALE_MS дошлёт заявку', async () => {
    let t = new Date('2026-10-12T10:00:00Z').getTime()
    deps.now = () => new Date(t)
    deps.b24.createDeal.mockImplementationOnce(() => new Promise<number>(() => {}))
    void submitOrder(session, ok, input(), deps)
    await new Promise(r => setTimeout(r, 0))
    t += SENDING_STALE_MS + 1
    expect(await submitOrder(session, ok, input(), deps)).toMatchObject({ ok: true, dealId: 501 })
  })

  it('повтор после сбоя берёт сохранённую строку: новые цены 1С в сделку не попадают', async () => {
    deps.b24.createDeal.mockRejectedValueOnce(new Error('503'))
    await submitOrder(session, ok, input(), deps)
    deps.prices = vi.fn(async (_c: string, items: string[]) => new Map(items.map(i => [i, priceOf(i, 99)])))
    expect(await submitOrder(session, ok, input(), deps)).toMatchObject({ ok: true })
    expect(deps.b24.createDeal.mock.calls[1]![0]).toMatchObject({ total: 55 })
    expect(deps.b24.createDeal.mock.calls[1]![0].rows.map((r: { price: number }) => r.price)).toEqual([2.5, 10])
    expect(deps.orders.list(7)[0]!.total).toBe(55)
  })

  it('та же заявка с правкой: до сделки — черновик обновляется; после — 409, это новая заявка', async () => {
    deps.b24.createDeal.mockRejectedValueOnce(new Error('503'))
    await submitOrder(session, ok, input(), deps)
    expect(await submitOrder(session, ok, input({ lines: [{ guid: g(2), qty: 4 }] }), deps)).toMatchObject({ ok: true })
    expect(deps.b24.createDeal.mock.calls[1]![0].rows).toEqual([{ name: 'Товар 2 (SKU-2)', price: 10, qty: 4, unit: 'шт', vatRate: 20 }])
    expect(deps.orders.list(7)[0]!.total).toBe(40)
    expect(await submitOrder(session, ok, input({ lines: [{ guid: g(2), qty: 5 }] }), deps)).toMatchObject({ ok: false, status: 409, error: 'already_sent' })
  })

  it('две валюты в одной заявке не уходят; 1С недоступна — 503', async () => {
    deps.prices = vi.fn(async () => new Map([[g(1), priceOf(g(1), 2.5)], [g(2), { ...priceOf(g(2), 10), currency: 'USD' }]]))
    expect(await submitOrder(session, ok, input(), deps)).toMatchObject({ status: 422, error: 'cart_invalid' })
    deps.prices = vi.fn(async () => { throw new Error('503') })
    expect(await submitOrder(session, ok, input(), deps)).toMatchObject({ status: 503, error: 'cart_invalid' })
    expect(deps.b24.createDeal).not.toHaveBeenCalled()
  })

  it('адрес из 1С с BB обезврежен; GUID адреса — в любом регистре; клиент удалён в 1С — 409', async () => {
    createClientStore(db).save([client({ deliveryAddresses: [{ guid: g(300), city: 'Минск', address: '[url=x]ул.[/url]' }] })])
    expect(await submitOrder(session, ok, input({ addressGuid: g(300).toUpperCase() }), deps)).toMatchObject({ ok: true })
    expect(deps.b24.createDeal.mock.calls[0]![0].comments).toContain('［url=x］ул.［/url］')
    createClientStore(db).save([client({ deleted: true })])
    expect(await submitOrder(session, ok, input({ requestId: '22222222-2222-4222-8222-222222222222' }), deps)).toMatchObject({ status: 409, error: 'no_contract' })
  })

  it('итог — сумма округлённых строк', async () => {
    deps.prices = vi.fn(async (_c: string, items: string[]) => new Map(items.map(i => [i, priceOf(i, 0.1)])))
    const q = await quoteCart([{ guid: g(2), qty: 3 }], deps.store, ok, deps.prices)
    expect(q.total).toBe(0.3)
  })

  it('«Мои заявки»: limit и offset зажаты', async () => {
    await submitOrder(session, ok, input(), deps)
    expect(deps.orders.list(7, 0, -5).length).toBe(1)
    expect(deps.orders.list(7, 20, Number.NaN).length).toBe(1)
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
    expect(f.calls.find(c => c.method === 'crm.deal.list')!.params.filter).toEqual({ ORIGINATOR_ID: DEAL_ORIGINATOR, ORIGIN_ID: REQ })
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
