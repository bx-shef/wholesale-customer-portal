import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from '../server/db/sqlite'
import { ODataClient, packFactor, packLabels } from '../server/services/onecOdata'
import { createCatalogStore } from '../server/utils/catalog'
import type { ItemT } from '../shared/onec/schemas'

const G = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

describe('упаковка товара из 1С (справка клиенту)', () => {
  it('коэффициент: Коэффициент, иначе Числитель / Знаменатель', () => {
    expect(packFactor({ Коэффициент: 12 })).toBe(12)
    expect(packFactor({ Числитель: 24, Знаменатель: 2 })).toBe(12)
    expect(packFactor({ Числитель: 5, Знаменатель: 0 })).toBe(0)
    expect(packFactor({})).toBe(0)
  })

  it('самая большая упаковка с коэффициентом больше 1', () => {
    const map = packLabels([
      { Owner_Key: G(1), Description: 'шт', Коэффициент: 1 },
      { Owner_Key: G(1), Description: 'уп (12 шт)', Коэффициент: 12 },
      { Owner_Key: G(1), Description: 'кор (144 шт)', Коэффициент: 144 },
      { Owner: G(2), Owner_Type: 'StandardODATA.Catalog_Номенклатура', Description: 'уп (6 шт)', Числитель: 6, Знаменатель: 1 },
      { Owner: G(3), Owner_Type: 'StandardODATA.Catalog_НаборыУпаковок', Description: 'уп (10 шт)', Коэффициент: 10 },
      { Owner_Key: G(4), Description: 'уп (5 шт)', Коэффициент: 5, DeletionMark: true },
      { Owner_Key: G(5), Description: '', Коэффициент: 5 },
      { Owner_Key: G(6), Description: 'шт', Коэффициент: 1 },
    ])
    expect(Object.fromEntries(map)).toEqual({ [G(1)]: 'кор (144 шт)', [G(2)]: 'уп (6 шт)' })
  })

  const snapshot = async (packs: (url: string) => Response) => {
    const fake: typeof fetch = async (u) => {
      const url = decodeURIComponent(String(u))
      if (url.includes('Catalog_УпаковкиЕдиницыИзмерения')) return packs(url)
      if (url.includes('Catalog_Номенклатура?')) return Response.json({ value: [{ Ref_Key: G(1), Description: 'Болт', DataVersion: 'v1' }] })
      return Response.json({ value: [] })
    }
    return new ODataClient({ baseUrl: 'https://x', auth: { kind: 'bearer', token: 't' }, fetch: fake }).catalogSnapshot()
  }

  it('снимок каталога: подпись упаковки у товара и в версии', async () => {
    const withPack = await snapshot(() => Response.json({ value: [{ Owner_Key: G(1), Description: 'уп (12 шт)', Коэффициент: 12 }] }))
    expect(withPack.items[0]!.item.packLabel).toBe('уп (12 шт)')
    const without = await snapshot(() => Response.json({ value: [] }))
    expect(without.items[0]!.item.packLabel).toBeUndefined()
    // Поменялась упаковка в 1С — версия другая, карточка обновится.
    expect(withPack.items[0]!.version).not.toBe(without.items[0]!.version)
  })

  it('набора нет или 1С не поняла запрос — каталог без упаковок', async () => {
    for (const status of [404, 400]) {
      const snap = await snapshot(() => new Response('', { status }))
      expect(snap.items).toHaveLength(1)
      expect(snap.items[0]!.item.packLabel).toBeUndefined()
    }
    await expect(snapshot(() => new Response('', { status: 500 }))).rejects.toMatchObject({ status: 500 })
  })

  it('база хранит подпись и отдаёт её в каталоге', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const store = createCatalogStore(db)
    const item: ItemT = { guid: G(1), sku: 'B', name: 'Болт', sectionGuid: G(900), brand: '', unit: 'шт', packQty: 1, minQty: 1, packLabel: 'уп (12 шт)', description: '', properties: {}, images: [], analogs: [], changedAt: '2026-11-10T10:00:00.000Z', deleted: false }
    store.saveCatalog([{ guid: G(900), parentGuid: null, name: 'Крепёж' }], [item, { ...item, guid: G(2), packLabel: undefined }])
    expect(store.item(G(1))!.packLabel).toBe('уп (12 шт)')
    expect(store.item(G(2))!.packLabel).toBe('')
  })
})
