import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { migrate } from '../server/db/sqlite'
import { createCatalogStore } from '../server/utils/catalog'
import { createPriceCache, PRICE_TTL_MS } from '../server/utils/prices'
import { catalogItem, catalogPage, createCompanyGuidResolver, parseCatalogQuery } from '../server/utils/catalogView'
import { generateSeed } from '../server/mocks/onec/seed'
import type { ItemT, PriceT } from '../shared/onec/schemas'

const seed = generateSeed(1)
const at = '2026-10-01T00:00:00Z'
const g = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const item = (n: number, over: Partial<ItemT> = {}): ItemT => ({
  guid: g(n), sku: `SKU-${n}`, name: `Товар ${n}`, sectionGuid: g(900), brand: 'Acme', unit: 'шт', packQty: 1, minQty: 1,
  description: '', properties: {}, images: [], analogs: [], changedAt: at, deleted: false, ...over,
})

describe('индекс каталога', () => {
  let store: ReturnType<typeof createCatalogStore>
  beforeEach(() => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    store = createCatalogStore(db)
  })

  it('сид мока целиком: разделы, товары, остатки; повтор не плодит дублей', () => {
    store.saveCatalog(seed.sections, seed.items)
    store.saveCatalog(seed.sections, seed.items)
    expect(store.search({ limit: 1 }).total).toBe(seed.items.filter(i => !i.deleted).length)
    expect(store.sections().length).toBe(seed.sections.length)
  })

  it('поиск по словам в названии и артикуле, без регистра, ё = е; % и _ — буквально', () => {
    store.saveCatalog([], [item(1, { name: 'Болт М10 оцинкованный' }), item(2, { name: 'Ёрш для труб', sku: 'ER-50' }), item(3, { name: '100% хлопок_x' })])
    expect(store.search({ q: 'болт м10' }).items.map(i => i.sku)).toEqual(['SKU-1'])
    expect(store.search({ q: 'ерш' }).items.map(i => i.sku)).toEqual(['ER-50'])
    expect(store.search({ q: 'er-50' }).items.map(i => i.sku)).toEqual(['ER-50'])
    expect(store.search({ q: '%' }).items.map(i => i.sku)).toEqual(['SKU-3'])
    expect(store.search({ q: '_' }).items.map(i => i.sku)).toEqual(['SKU-3'])
  })

  it('раздел включает подразделы; бренд и «в наличии» сужают', () => {
    store.saveCatalog([{ guid: g(900), parentGuid: null, name: 'Крепёж' }, { guid: g(901), parentGuid: g(900), name: 'Болты' }],
      [item(1), item(2, { sectionGuid: g(901), brand: 'Other' }), item(3, { sectionGuid: g(999) })])
    store.saveStock([{ itemGuid: g(2), warehouseGuid: g(500), warehouseName: 'Минск', available: 5, changedAt: at }])
    expect(store.search({ section: g(900) }).total).toBe(2)
    expect(store.search({ section: g(901) }).total).toBe(1)
    expect(store.search({ brand: 'Other' }).items.map(i => i.guid)).toEqual([g(2)])
    expect(store.search({ inStock: true }).items.map(i => i.guid)).toEqual([g(2)])
  })

  it('остатки суммируются по складам, обновляются, удалённый товар уходит вместе с остатками', () => {
    store.saveCatalog([], [item(1)])
    const st = (wh: number, available: number) => ({ itemGuid: g(1).toUpperCase(), warehouseGuid: g(wh), warehouseName: `Склад ${wh}`, available, changedAt: at })
    store.saveStock([st(500, 3), st(501, 4)])
    store.saveStock([st(500, 10)])
    expect(store.item(g(1))!.available).toBe(14)
    expect(store.item(g(1))!.stock.map(s => s.available)).toEqual([10, 4])
    store.saveCatalog([], [item(1, { deleted: true })])
    expect(store.item(g(1))).toBeNull()
    expect(store.search({ inStock: true }).total).toBe(0)
  })

  it('страницы: limit не больше 60, сортировка устойчива', () => {
    store.saveCatalog([], Array.from({ length: 70 }, (_, i) => item(i + 1, { name: 'Одинаковое' })))
    const a = store.search({ limit: 1000 })
    expect(a.items.length).toBe(60)
    const p1 = store.search({ limit: 30, offset: 0 }).items.map(i => i.guid)
    const p2 = store.search({ limit: 30, offset: 30 }).items.map(i => i.guid)
    expect(new Set([...p1, ...p2]).size).toBe(60)
  })

  it('аналогов не больше 12, сначала в наличии', () => {
    const many = Array.from({ length: 20 }, (_, i) => item(i + 10))
    store.saveCatalog([], [item(1, { analogs: many.map(a => a.guid) }), ...many])
    store.saveStock([{ itemGuid: g(29), warehouseGuid: g(500), warehouseName: 'Минск', available: 1, changedAt: at }])
    const analogs = store.item(g(1))!.analogs
    expect(analogs.length).toBe(12)
    expect(analogs[0]!.guid).toBe(g(29))
  })

  it('аналоги — из индекса, по GUID в любом регистре', () => {
    store.saveCatalog([], [item(1, { analogs: [g(2).toUpperCase()] }), item(2)])
    expect(store.item(g(1))!.analogs.map(a => a.guid)).toEqual([g(2)])
  })
})

describe('цены клиента', () => {
  const price = (item: string, v = 10): PriceT => ({ itemGuid: item, price: v, currency: 'BYN', vatRate: 20 })

  it('в 1С идут только недостающие, кэш 15 минут, отдельно по клиенту', async () => {
    let t = 0
    const load = vi.fn(async (_c: string, items: string[]) => items.map(i => price(i)))
    const cache = createPriceCache(load, () => t)
    await cache.get(g(100), [g(1), g(2)])
    await cache.get(g(100), [g(2), g(3)])
    expect(load.mock.calls.map(c => c[1])).toEqual([[g(1), g(2)], [g(3)]])
    await cache.get(g(101), [g(1)])
    expect(load).toHaveBeenCalledTimes(3)
    t = PRICE_TTL_MS + 1
    await cache.get(g(100), [g(1)])
    expect(load).toHaveBeenCalledTimes(4)
  })

  it('«нет цены» тоже кэшируется и не превращается в ноль', async () => {
    const load = vi.fn(async () => [] as PriceT[])
    const cache = createPriceCache(load, () => 0)
    expect((await cache.get(g(100), [g(1)])).size).toBe(0)
    await cache.get(g(100), [g(1)])
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('каталог глазами клиента', () => {
  let store: ReturnType<typeof createCatalogStore>
  beforeEach(() => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    store = createCatalogStore(db)
    store.saveCatalog([], [item(1, { analogs: [g(2)] }), item(2)])
  })

  it('цены запрашиваются по GUID клиента из сессии, а не из запроса', async () => {
    const prices = vi.fn(async (_c: string, items: string[]) => new Map(items.map(i => [i, { itemGuid: i, price: 5, currency: 'BYN', vatRate: 20 }])))
    const page = await catalogPage(store, parseCatalogQuery({ clientGuid: g(666) }), g(100), prices)
    expect(prices.mock.calls[0]![0]).toBe(g(100))
    expect(page.items[0]!.price).toEqual({ value: 5, currency: 'BYN', vatRate: 20 })
  })

  it('1С упала — каталог без цен и с флагом, а не 500 и не нули', async () => {
    const page = await catalogPage(store, {}, g(100), async () => { throw new Error('503') })
    expect(page.pricesAvailable).toBe(false)
    expect(page.items.every(i => i.price === null)).toBe(true)
  })

  it('карточка: цена товара и аналогов одним запросом', async () => {
    const prices = vi.fn(async (_c: string, items: string[]) => new Map(items.map(i => [i, { itemGuid: i, price: 7, currency: 'BYN', vatRate: 20 }])))
    const r = await catalogItem(store, g(1), g(100), prices)
    expect(prices).toHaveBeenCalledTimes(1)
    expect(r!.item.price!.value).toBe(7)
    expect(r!.item.analogs[0]!.price!.value).toBe(7)
    expect(await catalogItem(store, g(9), g(100), prices)).toBeNull()
  })

  it('разбор запроса: кривое отбрасывается', () => {
    expect(parseCatalogQuery({ section: 'x; DROP', sort: 'price', offset: '-5', limit: 'abc', inStock: 'yes' }))
      .toEqual({ q: undefined, section: undefined, brand: undefined, inStock: false, sort: undefined, offset: undefined, limit: undefined })
    expect(parseCatalogQuery({ sort: 'sku', inStock: '1', offset: '30' })).toMatchObject({ sort: 'sku', inStock: true, offset: 30 })
  })

  it('GUID компании кэшируется 10 минут', async () => {
    let t = 0
    const get = vi.fn(async () => ({ onecGuid: g(100) }))
    const resolve = createCompanyGuidResolver(get, () => t)
    await resolve(7)
    await resolve(7)
    expect(get).toHaveBeenCalledTimes(1)
    t = 10 * 60_000 + 1
    await resolve(7)
    expect(get).toHaveBeenCalledTimes(2)
  })
})
