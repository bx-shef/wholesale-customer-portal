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
