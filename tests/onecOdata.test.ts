import { describe, expect, it } from 'vitest'
import { EMPTY_REF, mapItem, ODataClient, ROOT_SECTION, type NomenclatureRow } from '../server/services/onecOdata'
import { CatalogPage } from '../shared/onec/schemas'

const G = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const AT = '2026-10-20T10:00:00.000Z'
const none = { units: new Map(), brands: new Map() }

describe('mapItem', () => {
  it('переносит поля номенклатуры в товар контракта', () => {
    const row: NomenclatureRow = {
      Ref_Key: G(10), Description: ' Клей  ', art_НаименованиеДляСайта: 'Клей плиточный 25 кг', Артикул: ' K-25 ',
      Parent_Key: G(1).toUpperCase(), Описание: 'описание', ЕдиницаИзмерения_Key: G(5), Марка_Key: G(6), ФайлКартинки_Key: G(7), DeletionMark: true,
    }
    const item = mapItem(row, { units: new Map([[G(5), 'мешок']]), brands: new Map([[G(6), 'Ceresit']]) }, AT)
    expect(item).toMatchObject({ sku: 'K-25', name: 'Клей плиточный 25 кг', sectionGuid: G(1), unit: 'мешок', brand: 'Ceresit', description: 'описание', deleted: true, changedAt: AT })
    expect(item.images).toEqual([{ id: G(7), hash: G(7).replaceAll('-', '') }])
  })

  it('без справочников и группы — запасные значения', () => {
    const item = mapItem({ Ref_Key: G(11), Description: 'Шпатель', Parent_Key: EMPTY_REF, ЕдиницаИзмерения_Key: G(5), ФайлКартинки_Key: EMPTY_REF }, none, AT)
    expect(item).toMatchObject({ name: 'Шпатель', sectionGuid: ROOT_SECTION.guid, unit: 'шт', brand: '', images: [], deleted: false })
  })
})

describe('ODataClient.catalog', () => {
  const folders = [{ Ref_Key: G(1), Description: 'Смеси', Parent_Key: EMPTY_REF, IsFolder: true }]
  const goods = Array.from({ length: 3 }, (_, i) => ({ Ref_Key: G(20 + i), Description: `Товар ${i}`, Parent_Key: G(1), IsFolder: false }))
  const urls: string[] = []
  const fake: typeof fetch = async (u) => {
    const url = decodeURIComponent(String(u))
    urls.push(url)
    if (url.includes('Марки')) return new Response('', { status: 404 })
    if (url.includes('УпаковкиЕдиницыИзмерения')) return Response.json({ value: [] })
    if (url.includes('IsFolder eq true')) return Response.json({ value: folders })
    const skip = Number(/\$skip=(\d+)/.exec(url)![1])
    const top = Number(/\$top=(\d+)/.exec(url)![1])
    return Response.json({ value: goods.slice(skip, skip + top) })
  }
  const client = new ODataClient({ baseUrl: 'https://1c.example/b/odata/standard.odata/', auth: { kind: 'basic', login: 'u', password: 'p' }, fetch: fake, now: () => new Date(AT) })

  it('страницы, разделы и проверка схемой', async () => {
    const look = await client.catalogLookups()
    expect(look.missing).toEqual(['Catalog_Марки'])
    const p1 = await client.catalog({ pageSize: 2 }, look)
    expect(CatalogPage.safeParse(p1).success).toBe(true)
    expect(p1.sections.map(s => s.name)).toEqual(['Без группы', 'Смеси'])
    expect(p1.items.map(i => i.name)).toEqual(['Товар 0', 'Товар 1'])
    expect(p1.nextPage).toBe(2)
    const p2 = await client.catalog({ page: 2, pageSize: 2 }, look)
    expect(p2).toMatchObject({ sections: [], nextPage: null })
    expect(p2.items.map(i => i.name)).toEqual(['Товар 2'])
    expect(urls.some(u => u.includes('$top=3&$skip=0') && u.includes('$select=Ref_Key,') && u.includes('$orderby=Ref_Key'))).toBe(true)
  })

  it('ответ без value — ошибка контракта', async () => {
    const bad = new ODataClient({ baseUrl: 'https://x', auth: { kind: 'bearer', token: 't' }, fetch: async () => Response.json({}) })
    await expect(bad.catalog({}, none)).rejects.toMatchObject({ kind: 'contract' })
  })
})

describe('цены и остатки', () => {
  const look = { currencies: new Map([[G(90), 'BYN']]), vat: new Map([[G(20), 20]]) }

  it('mapPrices: последняя цена, без характеристик и неизвестной валюты', async () => {
    const { mapPrices } = await import('../server/services/onecOdata')
    const rows = [
      { Period: '2026-01-01T00:00:00', Номенклатура_Key: G(20), ВидЦены_Key: G(30), Цена: 10, Валюта_Key: G(90) },
      { Period: '2026-03-01T00:00:00', Номенклатура_Key: G(20).toUpperCase(), ВидЦены_Key: G(30), Цена: 12.345, Валюта_Key: G(90) },
      { Period: '2026-04-01T00:00:00', Active: false, Номенклатура_Key: G(20), ВидЦены_Key: G(30), Цена: 99, Валюта_Key: G(90) },
      { Period: '2026-05-01T00:00:00', Номенклатура_Key: G(20), ВидЦены_Key: G(30), Цена: 50, Валюта_Key: G(90), ХарактеристикаЦО_Key: G(1) },
      { Period: '2026-01-01T00:00:00', Номенклатура_Key: G(21), ВидЦены_Key: G(30), Цена: 5, Валюта_Key: G(91) },
    ]
    expect(mapPrices(rows, look)).toEqual([{ priceTypeGuid: G(30), itemGuid: G(20), price: 12.35, currency: 'BYN', vatRate: 20, changedAt: '2026-03-01T00:00:00+03:00', deleted: false }])
  })

  it('mapStock: свободный остаток не меньше нуля', async () => {
    const { mapStock } = await import('../server/services/onecOdata')
    const rows = [
      { Номенклатура_Key: G(20), Склад_Key: G(40), ВНаличииBalance: 10, КОтгрузкеBalance: 3 },
      { Номенклатура_Key: G(21), Склад_Key: G(40), ВНаличииBalance: 1, КОтгрузкеBalance: 4 },
      { Номенклатура_Key: G(22), Склад_Key: EMPTY_REF, ВНаличииBalance: 5 },
    ]
    expect(mapStock(rows, new Map([[G(40), 'Основной']]), AT)).toEqual([
      { itemGuid: G(20), warehouseGuid: G(40), warehouseName: 'Основной', available: 7, changedAt: AT },
      { itemGuid: G(21), warehouseGuid: G(40), warehouseName: 'Основной', available: 0, changedAt: AT },
    ])
  })

  it('currencyCode и vatPercent', async () => {
    const { currencyCode, vatPercent } = await import('../server/services/onecOdata')
    expect([currencyCode('933', 'руб.'), currencyCode('', 'usd'), currencyCode('1', 'x')]).toEqual(['BYN', 'USD', null])
    expect([vatPercent(10), vatPercent(undefined, '20%'), vatPercent(undefined, 'Без НДС')]).toEqual([10, 20, 0])
  })

  it('prices: срез у _RecordType; stock — через Balance', async () => {
    const urls: string[] = []
    const fake: typeof fetch = async (u) => {
      const url = decodeURIComponent(String(u))
      urls.push(url)
      if (url.includes('ЦеныНоменклатуры_RecordType/SliceLast')) return Response.json({ value: [{ Period: '2026-01-01T00:00:00', Номенклатура_Key: G(20), ВидЦены_Key: G(30), Цена: 1, Валюта_Key: G(90) }, { Номенклатура_Key: G(20), ВидЦены_Key: G(30), Цена: 2, Валюта_Key: G(90), Характеристика_Key: G(2) }] })
      if (url.includes('Catalog_Валюты')) return Response.json({ value: [{ Ref_Key: G(90), Code: '933', Description: 'руб.' }] })
      if (url.includes('Catalog_СтавкиНДС')) return Response.json({ value: [{ Ref_Key: G(60), Description: '20%' }] })
      if (url.includes('Catalog_Номенклатура')) return Response.json({ value: [{ Ref_Key: G(20), СтавкаНДС_Key: G(60) }] })
      if (url.includes('/Balance(')) return Response.json({ value: [{ Номенклатура_Key: G(20), Склад_Key: G(40), ВНаличииBalance: 2 }] })
      if (url.includes('Catalog_Склады')) return Response.json({ value: [{ Ref_Key: G(40), Description: 'Склад' }] })
      return new Response('', { status: 404 })
    }
    const c = new ODataClient({ baseUrl: 'https://x/odata', auth: { kind: 'bearer', token: 't' }, fetch: fake, now: () => new Date(AT) })
    const p = await c.prices({ priceTypes: [G(30)] })
    expect(p).toMatchObject({ via: 'slice', register: 'InformationRegister_ЦеныНоменклатуры', tried: [], missing: [], items: [{ price: 1, currency: 'BYN', vatRate: 20 }], stats: { read: 2, variant: 1 } })
    expect(urls.find(u => u.includes('SliceLast'))).toContain(`ВидЦены_Key eq guid'${G(30)}'`)
    expect(await c.stock()).toEqual([{ itemGuid: G(20), warehouseGuid: G(40), warehouseName: 'Склад', available: 2, changedAt: AT }])
    expect(urls.some(u => u.includes("/Balance(Dimensions='Номенклатура,Склад')?"))).toBe(true)
  })
})

describe('prices: страницы среза и запасной путь', () => {
  it('_RecordType отвергнут — срез у самого регистра, страницами; текст ошибки 1С в tried', async () => {
    const urls: string[] = []
    const fake: typeof fetch = async (u) => {
      const url = decodeURIComponent(String(u))
      urls.push(url)
      if (url.includes('_RecordType/SliceLast')) return Response.json({ 'odata.error': { code: '-1', message: { lang: 'ru', value: 'Неверный запрос' } } }, { status: 400 })
      if (url.includes('ЦеныНоменклатуры/SliceLast')) {
        const skip = Number(/\$skip=(\d+)/.exec(url)![1])
        const all = Array.from({ length: 7 }, (_, k) => ({ Period: '2026-02-01T00:00:00', Номенклатура_Key: G(20 + k), ВидЦены_Key: G(30), Цена: k + 1, Валюта_Key: G(90) }))
        const top = Number(/\$top=(\d+)/.exec(url)![1])
        return Response.json({ value: all.slice(skip, skip + top) })
      }
      if (url.includes('Catalog_Валюты')) return Response.json({ value: [{ Ref_Key: G(90), Description: 'BYN' }] })
      if (url.includes('Catalog_СтавкиНДС') || url.includes('Catalog_Номенклатура')) return Response.json({ value: [] })
      return new Response('', { status: 404 })
    }
    const c = new ODataClient({ baseUrl: 'https://x/odata', auth: { kind: 'bearer', token: 't' }, fetch: fake })
    const p = await c.prices({ limit: 3 })
    expect(p.items.map(i => i.price)).toEqual([1, 2, 3])
    expect(p.tried[0]).toContain('HTTP 400 — Неверный запрос')
    expect(urls.some(u => u.includes('ЦеныНоменклатуры/SliceLast()?') && u.includes('$top=3&$skip=0'))).toBe(true)
  })
})

describe('stock: склады', () => {
  it('оставляет только заданные склады, без учёта регистра', async () => {
    const fake: typeof fetch = async (u) => {
      const url = decodeURIComponent(String(u))
      if (url.includes('/Balance(')) return Response.json({ value: [
        { Номенклатура_Key: G(20), Склад_Key: G(40), ВНаличииBalance: 2 },
        { Номенклатура_Key: G(20), Склад_Key: G(41), ВНаличииBalance: 9 },
      ] })
      if (url.includes('Catalog_Склады')) return Response.json({ value: [{ Ref_Key: G(40), Description: 'Основной склад' }, { Ref_Key: G(41), Description: 'Грузовой автомобиль' }] })
      return new Response('', { status: 404 })
    }
    const c = new ODataClient({ baseUrl: 'https://x', auth: { kind: 'bearer', token: 't' }, fetch: fake, now: () => new Date(AT), stockWarehouses: ['основной СКЛАД'] })
    expect((await c.stock()).map(s => s.warehouseName)).toEqual(['Основной склад'])
  })
})

describe('журнал запросов и предел для стенда', () => {
  it('onRequest пишет каждый запрос; prices({ limit }) просит $top и НДС только своих товаров', async () => {
    const urls: string[] = []
    const fake: typeof fetch = async (u) => {
      const url = decodeURIComponent(String(u))
      urls.push(url)
      if (url.includes('ЦеныНоменклатуры_RecordType/SliceLast')) return Response.json({ value: [{ Номенклатура_Key: G(20), ВидЦены_Key: G(30), Цена: 1, Валюта_Key: G(90) }] })
      if (url.includes('Catalog_Валюты')) return Response.json({ value: [{ Ref_Key: G(90), Description: 'BYN' }] })
      if (url.includes('Catalog_СтавкиНДС')) return Response.json({ value: [] })
      if (url.includes('Catalog_Номенклатура')) return Response.json({ value: [] })
      return new Response('', { status: 404 })
    }
    const log: string[] = []
    const c = new ODataClient({ baseUrl: 'https://x', auth: { kind: 'bearer', token: 't' }, fetch: fake, onRequest: e => log.push(`${e.label}:${e.rows ?? e.error}`) })
    await c.prices({ limit: 10 })
    expect(urls[0]).toContain('$top=10')
    expect(urls.find(u => u.includes('Catalog_Номенклатура'))).toContain(`Ref_Key eq guid'${G(20)}'`)
    expect(log[0]).toBe('InformationRegister_ЦеныНоменклатуры_RecordType/SliceLast [$top=10]:1')
  })
})
