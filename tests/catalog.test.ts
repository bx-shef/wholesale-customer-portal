import { readFileSync } from 'node:fs'
import { DEFAULT_FILTER_PROPERTIES, parsePropertyList, selectedSummary } from '../shared/propFilter'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { migrate } from '../server/db/sqlite'
import { createCatalogStore, hiddenSectionGuids, visibleProperties } from '../server/utils/catalog'
import { createPriceStore } from '../server/utils/prices'
import { createClientStore } from '../server/utils/clients'
import { catalogItem, catalogPage, COMPANY_NO_GUID_TTL_MS, createCompanyGuidResolver, parseCatalogQuery, resolvePricing } from '../server/utils/catalogView'
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
    expect(store.search({ brand: ['Other'] }).items.map(i => i.guid)).toEqual([g(2)])
    expect(store.search({ brand: ['Other', 'Acme'] }).total).toBe(3)
    expect(store.search({ inStock: true }).items.map(i => i.guid)).toEqual([g(2)])
    expect(store.stockSections()).toEqual([g(901)])
    expect(store.itemSections().sort()).toEqual([g(900), g(901), g(999)].sort())
    // Подразделы: только внутри раздела; чужой GUID не расширяет выборку.
    expect(store.search({ section: g(900), sub: [g(901)] }).items.map(i => i.guid)).toEqual([g(2)])
    expect(store.search({ section: g(900), sub: [g(999)] }).total).toBe(2)
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

  it('остатки снимком: строки старше снимка уходят (OData)', () => {
    store.saveCatalog([], [item(1), item(2)])
    const old = '2026-10-01T00:00:00.000Z'
    const snap = '2026-10-01T00:05:00.000Z'
    store.saveStock([{ itemGuid: g(1), warehouseGuid: g(500), warehouseName: 'Основной склад', available: 3, changedAt: old }, { itemGuid: g(2), warehouseGuid: g(500), warehouseName: 'Основной склад', available: 7, changedAt: old }])
    store.saveStock([{ itemGuid: g(2), warehouseGuid: g(500), warehouseName: 'Основной склад', available: 6, changedAt: snap }])
    expect(store.pruneStockBefore(snap)).toBe(1)
    expect(store.item(g(1))!.available).toBe(0)
    expect(store.item(g(2))!.available).toBe(6)
  })

  it('limit 0 и отрицательный — не «без лимита»', () => {
    store.saveCatalog([], Array.from({ length: 70 }, (_, i) => item(i + 1)))
    expect(store.search({ limit: 0 }).items.length).toBe(1)
    expect(store.search({ limit: -5 }).items.length).toBe(1)
  })

  it('длинный запрос обрезается, лишние слова не превращаются в десятки LIKE', () => {
    store.saveCatalog([], [item(1, { name: 'Болт' })])
    expect(store.search({ q: 'болт ' + 'x'.repeat(500) }).total).toBe(0)
    // Слова сверх пяти отбрасываются: шестое «я» не нашлось бы, но до него поиск не доходит.
    expect(store.search({ q: 'болт о л т б я' }).total).toBe(1)
  })

  it('сортировка по названию — без регистра, ё рядом с е; при равенстве — по GUID', () => {
    store.saveCatalog([], [item(3, { name: 'ёлка' }), item(1, { name: 'Ель' }), item(2, { name: 'ежевика' }), item(4, { name: 'Дуб' })])
    expect(store.search({ sort: 'name' }).items.map(i => i.name)).toEqual(['Дуб', 'ежевика', 'ёлка', 'Ель'])
    store.saveCatalog([], [item(5, { name: 'Same', sku: 'S' }), item(6, { name: 'Same', sku: 'S' })])
    const ids = store.search({ q: 'same', sort: 'sku' }).items.map(i => i.guid)
    expect(ids).toEqual([g(5), g(6)])
  })

  it('«сначала в наличии»: по убыванию остатка', () => {
    store.saveCatalog([], [item(1), item(2), item(3)])
    const st = (n: number, available: number) => ({ itemGuid: g(n), warehouseGuid: g(500), warehouseName: 'Минск', available, changedAt: at })
    store.saveStock([st(1, 1), st(2, 50), st(3, 0)])
    expect(store.search({ sort: 'available' }).items.map(i => i.guid)).toEqual([g(2), g(1), g(3)])
  })

  it('удалённый товар уносит остатки; остаток товара не из витрины не хранится', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const s2 = createCatalogStore(db)
    const st = (n: number) => ({ itemGuid: g(n), warehouseGuid: g(500), warehouseName: 'Минск', available: 9, changedAt: at })
    s2.saveCatalog([], [item(1)])
    s2.saveStock([st(1), st(2)])
    const count = () => (db.prepare('SELECT COUNT(*) AS n FROM stock').get() as { n: number }).n
    expect(count()).toBe(1)
    s2.saveCatalog([], [item(1, { deleted: true })])
    expect(count()).toBe(0)
    s2.saveCatalog([], [item(1)])
    expect(s2.item(g(1))!.available).toBe(0)
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

describe('цены клиента — из прайса в базе ЛК (§2.4)', () => {
  const contract = (priceTypeGuid: string) => ({ guid: g(500), number: 'ОПТ-1', date: '2026-01-01', priceTypeGuid, paymentDelayDays: 0, creditLimit: 0, debt: 0, currency: 'BYN' })
  const row = (pt: string, itemN: number, price: number, over: Partial<PriceT> = {}): PriceT => ({ priceTypeGuid: pt, itemGuid: g(itemN), price, currency: 'BYN', vatRate: 20, changedAt: at, deleted: false, ...over })
  const setup = () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const clients = createClientStore(db)
    clients.save([
      { guid: g(100), name: 'А', unp: '', address: '', city: '', managerEmail: '', contract: contract(g(700)), deliveryAddresses: [], changedAt: at, deleted: false },
      { guid: g(101), name: 'Б', unp: '', address: '', city: '', managerEmail: '', contract: contract(g(701)), deliveryAddresses: [], changedAt: at, deleted: false },
      { guid: g(102), name: 'В', unp: '', address: '', city: '', managerEmail: '', contract: null, deliveryAddresses: [], changedAt: at, deleted: false },
    ])
    return createPriceStore(db)
  }

  it('цена — по виду цен договора клиента, у другого клиента своя', async () => {
    const prices = setup()
    prices.save([row(g(700), 1, 10), row(g(701), 1, 9), row(g(700), 2, 20)])
    expect([...(await prices.get(g(100), [g(1), g(2), g(3)])).entries()].map(([k, v]) => [k, v.price])).toEqual([[g(1), 10], [g(2), 20]])
    expect((await prices.get(g(101).toUpperCase(), [g(1)])).get(g(1))!.price).toBe(9)
  })

  it('без договора или без клиента — цен нет', async () => {
    const prices = setup()
    prices.save([row(g(700), 1, 10)])
    expect((await prices.get(g(102), [g(1)])).size).toBe(0)
    expect((await prices.get(g(999), [g(1)])).size).toBe(0)
  })

  it('новая цена заменяет старую, deleted — снимает', async () => {
    const prices = setup()
    prices.save([row(g(700), 1, 10)])
    prices.save([row(g(700), 1, 11)])
    expect((await prices.get(g(100), [g(1)])).get(g(1))!.price).toBe(11)
    prices.save([row(g(700), 1, 11, { deleted: true })])
    expect((await prices.get(g(100), [g(1)])).size).toBe(0)
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
    const page = await catalogPage(store, parseCatalogQuery({ clientGuid: g(666) }), await resolvePricing({ companyId: 7 }, async () => g(100)), prices)
    expect(prices.mock.calls[0]![0]).toBe(g(100))
    expect(page.items[0]!.price).toEqual({ value: 5, currency: 'BYN', vatRate: 20 })
  })

  it('1С упала — каталог без цен и с флагом, а не 500 и не нули', async () => {
    const page = await catalogPage(store, {}, { status: 'ok', clientGuid: g(100) }, async () => { throw new Error('503') })
    expect(page.priceStatus).toBe('unavailable')
    expect(page.items.every(i => i.price === null)).toBe(true)
  })

  it('карточка: цена товара и аналогов одним запросом', async () => {
    // Разные цены: перепутать цену товара и аналога тест не даст.
    const prices = vi.fn(async (_c: string, items: string[]) => new Map(items.map(i => [i, { itemGuid: i, price: i === g(1) ? 7 : 9, currency: 'BYN', vatRate: 20 }])))
    const ok = { status: 'ok' as const, clientGuid: g(100) }
    const r = await catalogItem(store, g(1), ok, prices)
    expect(prices).toHaveBeenCalledTimes(1)
    expect(r!.item.price!.value).toBe(7)
    expect(r!.item.analogs[0]!.price!.value).toBe(9)
    expect(await catalogItem(store, g(9), ok, prices)).toBeNull()
  })

  it('у компании нет GUID 1С — цен нет, 1С не спрашиваем, статус «нет договора»', async () => {
    const prices = vi.fn(async () => new Map())
    const pricing = await resolvePricing({ companyId: 7 }, async () => null)
    const page = await catalogPage(store, {}, pricing, prices)
    expect(page.priceStatus).toBe('no-contract')
    expect(page.items.every(i => i.price === null)).toBe(true)
    expect(prices).not.toHaveBeenCalled()
  })

  it('без сессии — 401 до запроса в CRM; CRM упала — «недоступны», а не «нет договора»', async () => {
    const resolve = vi.fn(async () => g(100))
    await expect(resolvePricing(null, resolve)).rejects.toMatchObject({ statusCode: 401 })
    expect(resolve).not.toHaveBeenCalled()
    expect(await resolvePricing({ companyId: 7 }, async () => { throw new Error('ECONNRESET') })).toEqual({ status: 'unavailable' })
    expect(await resolvePricing({ companyId: 7 }, resolve)).toEqual({ status: 'ok', clientGuid: g(100) })
    expect(resolve).toHaveBeenCalledWith(7)
  })

  it('разбор запроса: кривое отбрасывается', () => {
    expect(parseCatalogQuery({ section: 'x; DROP', sort: 'random', offset: '-5', limit: 'abc', inStock: 'yes' }))
      .toEqual({ q: undefined, section: undefined, brand: undefined, inStock: false, sort: undefined, offset: undefined, limit: undefined })
    expect(parseCatalogQuery({ sort: 'sku', inStock: '1', offset: '30' })).toMatchObject({ sort: 'sku', inStock: true, offset: 30 })
    expect(parseCatalogQuery({ limit: '0', section: '-'.repeat(36) })).toMatchObject({ limit: undefined, section: undefined })
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

  it('«GUID нет» живёт минуту: только что привязанный клиент быстро видит цены', async () => {
    let t = 0
    let guid: string | null = null
    const get = vi.fn(async () => ({ onecGuid: guid }))
    const resolve = createCompanyGuidResolver(get, () => t)
    expect(await resolve(7)).toBeNull()
    guid = g(100)
    t = COMPANY_NO_GUID_TTL_MS - 1
    expect(await resolve(7)).toBeNull()
    t = COMPANY_NO_GUID_TTL_MS + 1
    expect(await resolve(7)).toBe(g(100))
  })
})

describe('сортировка по цене соглашения (#86)', () => {
  const pt = g(700)
  const setup = () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const store = createCatalogStore(db)
    store.saveCatalog([], [item(1, { name: 'А' }), item(2, { name: 'Б' }), item(3, { name: 'В' }), item(4, { name: 'Г' })])
    createPriceStore(db).save([
      { priceTypeGuid: pt, itemGuid: g(1), price: 30, currency: 'BYN', vatRate: 20, changedAt: at, deleted: false },
      { priceTypeGuid: pt, itemGuid: g(2), price: 10, currency: 'BYN', vatRate: 20, changedAt: at, deleted: false },
      { priceTypeGuid: pt, itemGuid: g(3), price: 20, currency: 'BYN', vatRate: 20, changedAt: at, deleted: false },
      // Другой вид цен — на порядок не влияет.
      { priceTypeGuid: g(701), itemGuid: g(4), price: 1, currency: 'BYN', vatRate: 20, changedAt: at, deleted: false },
    ])
    return store
  }

  it('сначала дешевле / дороже — по виду цен клиента, товары без цены в конце', () => {
    const store = setup()
    expect(store.search({ sort: 'price', priceType: pt }).items.map(i => i.name)).toEqual(['Б', 'В', 'А', 'Г'])
    expect(store.search({ sort: 'price_desc', priceType: pt.toUpperCase() }).items.map(i => i.name)).toEqual(['А', 'В', 'Б', 'Г'])
  })

  it('вместе с фильтром: параметры JOIN и WHERE не путаются, total — по фильтру', () => {
    const store = setup()
    store.saveCatalog([], [item(5, { name: 'Д', brand: 'Other' })])
    const r = store.search({ sort: 'price', priceType: pt, brand: ['Acme'], limit: 2, offset: 1 })
    expect(r.items.map(i => i.name)).toEqual(['В', 'А'])
    expect(r.total).toBe(4)
  })

  it('без вида цен — по названию, а не случайно', () => {
    expect(setup().search({ sort: 'price' }).items.map(i => i.name)).toEqual(['А', 'Б', 'В', 'Г'])
  })

  it('параметр sort=price из адреса принимается', () => {
    expect(parseCatalogQuery({ sort: 'price_desc' }).sort).toBe('price_desc')
  })
})

describe('данные мока (#86)', () => {
  it('вес демо-товара — из фасовки в названии', async () => {
    const { weightOf } = await import('../server/mocks/onec/seed')
    expect(weightOf('ilmax CemTop Express (25кг) стяжка', 7)).toBe('25 кг')
    expect(weightOf('Шпатлевка SP21 4кг белая', 7)).toBe('4 кг')
    expect(weightOf(undefined, 7)).toBe('7 кг')
    expect(weightOf(undefined, 14, { unit: 'кг', packQty: 1 })).toBe('1 кг')
    expect(weightOf(undefined, 14, { unit: 'шт', packQty: 1 })).toBe('14 кг')
  })

  it('товар в килограммах: вес совпадает с фасовкой; аналоги в той же единице', () => {
    const byGuid = new Map(seed.items.map(i => [i.guid, i]))
    for (const i of seed.items) {
      if (i.unit === 'кг') expect(i.properties['Вес']).toBe(`${i.packQty} кг`)
      // Витринные товары algena.by — «шт» независимо от раздела; сверяем только сгенерированные.
      const generated = (x: { name: string }) => x.name.includes(':')
      for (const a of i.analogs) {
        const analog = byGuid.get(a)!
        if (generated(i) && generated(analog)) expect(analog.unit).toBe(i.unit)
      }
    }
  })

  it('у товаров одного раздела разные аналоги', () => {
    const bySection = new Map<string, Set<string>>()
    for (const i of seed.items) {
      const set = bySection.get(i.sectionGuid) ?? new Set<string>()
      set.add([...i.analogs].sort().join(','))
      bySection.set(i.sectionGuid, set)
    }
    for (const sets of bySection.values()) expect(sets.size).toBeGreaterThan(1)
  })
})

describe('скрытые разделы (CATALOG_HIDDEN_SECTIONS)', () => {
  it('раздел по названию без учёта регистра — скрыт вместе с подразделами и товарами', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    let names: string[] = ['не используются']
    const store = createCatalogStore(db, { hiddenSections: () => names })
    store.saveCatalog(
      [{ guid: g(900), parentGuid: null, name: 'Крепёж' }, { guid: g(910), parentGuid: null, name: 'Не используются' }, { guid: g(911), parentGuid: g(910), name: 'Старое' }],
      [item(1), item(2, { sectionGuid: g(911), brand: 'Скрытый' })],
    )
    expect(store.sections().map(s => s.name)).toEqual(['Крепёж'])
    expect(store.search({}).items.map(i => i.guid)).toEqual([g(1)])
    expect(store.item(g(2))).toBeNull()
    expect(store.brands()).not.toContain('Скрытый')
    expect(store.itemSections()).toEqual([g(900)])
    // Список пуст — всё видно.
    names = []
    expect(store.search({}).total).toBe(2)
    expect(hiddenSectionGuids([{ guid: 'A', parentGuid: null, name: ' УСЛУГИ ' }], ['услуги'])).toEqual(new Set(['a']))
  })
  it('скрытые характеристики — по названию, без учёта регистра', () => {
    expect(visibleProperties({ 'Цвет': 'Черный', 'ГруппаДляСтатистики': 'Прочие' }, [' группадлястатистики '])).toEqual({ 'Цвет': 'Черный' })
    expect(visibleProperties({ 'Цвет': 'Черный' }, [])).toEqual({ 'Цвет': 'Черный' })
  })
})

describe('очередь картинок', () => {
  it('сначала в наличии, потом остальные, скрытые разделы — в конце', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const store = createCatalogStore(db, { hiddenSections: () => ['Скрытый'] })
    const img = (n: number) => [{ id: g(700 + n), hash: `h${n}` }]
    store.saveCatalog([{ guid: g(900), parentGuid: null, name: 'Крепёж' }, { guid: g(910), parentGuid: null, name: 'Скрытый' }], [
      item(1, { name: 'А', images: img(1) }),
      item(2, { name: 'Б', images: img(2) }),
      item(3, { name: 'В', sectionGuid: g(910), images: img(3) }),
    ])
    store.saveStock([2, 3].map(n => ({ itemGuid: g(n), warehouseGuid: g(500), warehouseName: 'Склад', available: 5, changedAt: at })))
    expect(store.imageRefs().map(r => r.id)).toEqual([g(702), g(701), g(703)])
  })
})

describe('фильтр по характеристикам (владелец 2026-10-27)', () => {
  const mk = (hidden: string[] = []) => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const store = createCatalogStore(db, { filterProperties: () => ['Цвет', 'Объём', 'Секрет'], hiddenProperties: () => hidden })
    store.saveCatalog([{ guid: g(900), parentGuid: null, name: 'Краски' }, { guid: g(901), parentGuid: null, name: 'Крепёж' }], [
      item(1, { properties: { 'Цвет': 'Белый', 'Объём': '10 л', 'Секрет': 'а', 'Артикул поставщика': 'x' } }),
      item(2, { properties: { 'Цвет': 'Белый', 'Объём': '2,5 л', 'Секрет': 'б' } }),
      item(3, { properties: { 'Цвет': 'Серый', 'Объём': '10 л' } }),
      item(4, { sectionGuid: g(901), properties: { 'Цвет': 'Чёрный' } }),
    ])
    return store
  }

  it('значения: только из списка, с подсчётом, по-человечески; одно значение — не фильтр', () => {
    const f = mk().facets(g(900))
    expect(f.map(x => x.name)).toEqual(['Цвет', 'Объём', 'Секрет'])
    expect(f[1]!.values).toEqual([{ value: '2,5 л', count: 1 }, { value: '10 л', count: 2 }])
    expect(f[0]!.values.map(v => v.value)).toEqual(['Белый', 'Серый'])
  })

  it('скрытая характеристика в фильтре не показывается и не фильтрует', () => {
    const store = mk(['Секрет'])
    expect(store.facets(g(900)).map(x => x.name)).not.toContain('Секрет')
    expect(store.search({ props: { 'Секрет': ['а'] } }).total).toBe(4)
  })

  it('внутри характеристики — «или», между — «и»; не из списка — игнор', () => {
    const store = mk()
    expect(store.search({ props: { 'Цвет': ['Белый', 'Серый'] } }).items.map(i => i.guid)).toEqual([g(1), g(2), g(3)])
    expect(store.search({ props: { 'Цвет': ['Белый'], 'Объём': ['10 л'] } }).items.map(i => i.guid)).toEqual([g(1)])
    expect(store.search({ props: { 'Артикул поставщика': ['x'] } }).total).toBe(4)
  })

  it('адрес: prop=Название::Значение, кривое отбрасывается', () => {
    expect(parseCatalogQuery({ prop: ['Цвет::Белый', 'Цвет::Серый', 'мусор', '::x', 'Объём::'] }).props).toEqual({ 'Цвет': ['Белый', 'Серый'] })
  })
})

describe('фильтр характеристик: стенд 2026-10-27 (фильтр был пуст)', () => {
  it('запрос характеристик объявлен после filters — иначе обращение до объявления', () => {
    const src = readFileSync('app/pages/index.vue', 'utf8')
    expect(src.indexOf("useLazyFetch<{ facets")).toBeGreaterThan(src.indexOf('const filters = computed('))
  })
  it('названия с запятой: из окружения через «;»', () => {
    expect(parsePropertyList('Цвет; Длина, мм')).toEqual(['Цвет', 'Длина, мм'])
    expect(parsePropertyList('Цвет, Вес')).toEqual(['Цвет', 'Вес'])
    expect(DEFAULT_FILTER_PROPERTIES).toEqual(expect.arrayContaining(['Цвет', 'Степень блеска', 'Объем', 'Страна изготовления', 'Длина, мм']))
  })
})

describe('несколько значений в поле фильтра — коротко (владелец 2026-10-27)', () => {
  it('«первое и ещё N»', () => {
    expect(selectedSummary([])).toBe('')
    expect(selectedSummary(['По бетону'])).toBe('По бетону')
    expect(selectedSummary(['По бетону', 'По керамике', 'Универсальный'])).toBe('По бетону и ещё 2')
  })
  it('поля фильтров показывают сводку, а не весь список', () => {
    expect(readFileSync('app/pages/index.vue', 'utf8').match(/selectedSummary\(asList\(modelValue\)\)/g)?.length).toBe(4)
  })
})

describe('короткие характеристики — галочками (владелец 2026-10-27)', () => {
  it('до 12 значений — B24CheckboxGroup, больше — список с поиском', () => {
    const src = readFileSync('app/pages/index.vue', 'utf8')
    expect(src).toContain('const CHECKBOX_MAX = 12')
    expect(src).toMatch(/<B24CheckboxGroup\s+v-if="f\.values\.length <= CHECKBOX_MAX"/)
    expect(src).toMatch(/<B24SelectMenu\s+v-else/)
  })
})

describe('значения фильтра без числа товаров (владелец 2026-10-28)', () => {
  it('подпись — только значение', () => {
    expect(readFileSync('app/pages/index.vue', 'utf8')).toContain('f.values.map(v => ({ label: v.value, value: v.value }))')
  })
})
