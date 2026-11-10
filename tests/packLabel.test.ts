import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from '../server/db/sqlite'
import { choosePack, ODATA_PAGE, ODataClient, packFactor, packLabels } from '../server/services/onecOdata'
import { createCatalogStore, storedPackLabels } from '../server/utils/catalog'
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

  const snapshot = async (packs: (url: string) => Response, previous?: Map<string, string>, guid = G(1)) => {
    const fake: typeof fetch = async (u) => {
      const url = decodeURIComponent(String(u))
      if (url.includes('Catalog_УпаковкиЕдиницыИзмерения')) return packs(url)
      if (url.includes('Catalog_Номенклатура?')) return Response.json({ value: [{ Ref_Key: guid, Description: 'Болт', DataVersion: 'v1' }] })
      return Response.json({ value: [] })
    }
    return new ODataClient({ baseUrl: 'https://x', auth: { kind: 'bearer', token: 't' }, fetch: fake, previousPackLabels: previous && (() => previous) }).catalogSnapshot()
  }

  it('снимок каталога: подпись упаковки у товара и в версии', async () => {
    const withPack = await snapshot(() => Response.json({ value: [{ Owner_Key: G(1), Description: 'уп (12 шт)', Коэффициент: 12 }] }))
    expect(withPack.items[0]!.item.packLabel).toBe('уп (12 шт)')
    const without = await snapshot(() => Response.json({ value: [] }))
    expect(without.items[0]!.item.packLabel).toBeUndefined()
    // Поменялась упаковка в 1С — версия другая, карточка обновится.
    expect(withPack.items[0]!.version).not.toBe(without.items[0]!.version)
  })

  it('любой сбой справочника — каталог не падает, подписи берутся из базы', async () => {
    const prev = new Map([[G(1), 'уп (12 шт)']])
    const withPack = await snapshot(() => Response.json({ value: [{ Owner_Key: G(1), Description: 'уп (12 шт)', Коэффициент: 12 }] }))
    for (const status of [404, 400, 500, 503]) {
      const snap = await snapshot(() => new Response('', { status }))
      expect(snap.items).toHaveLength(1)
      expect(snap.items[0]!.item.packLabel).toBeUndefined()
      // «Неизвестны» — прежняя подпись и прежняя версия, ничего не стирается.
      const kept = await snapshot(() => new Response('', { status }), prev)
      expect(kept.items[0]!.item.packLabel).toBe('уп (12 шт)')
      expect(kept.items[0]!.version).toBe(withPack.items[0]!.version)
    }
    // «Пусто» — не «неизвестно»: справочник ответил без упаковок, база не подставляется.
    const empty = await snapshot(() => Response.json({ value: [] }), prev)
    expect(empty.items[0]!.item.packLabel).toBeUndefined()
    // Сетевой сбой — тоже «неизвестны».
    const net = await snapshot(() => { throw new Error('ECONNRESET') }, prev)
    expect(net.items[0]!.item.packLabel).toBe('уп (12 шт)')
  })

  it('сбой посреди чтения страниц — упаковки неизвестны, а не половина', async () => {
    const prev = new Map([[G(1), 'старая']])
    const full = Array.from({ length: ODATA_PAGE }, (_, i) => ({ Owner_Key: G(1000 + i), Description: 'уп', Коэффициент: 2 }))
    const snap = await snapshot((url) => url.includes('$skip=0') ? Response.json({ value: [...full.slice(1), { Owner_Key: G(1), Description: 'новая', Коэффициент: 3 }] }) : new Response('', { status: 502 }), prev)
    expect(snap.items[0]!.item.packLabel).toBe('старая')
  })

  it('две страницы справочника: вторая — со $skip, упаковка с неё доходит', async () => {
    const urls: string[] = []
    const full = Array.from({ length: ODATA_PAGE }, (_, i) => ({ Owner_Key: G(1000 + i), Description: 'уп', Коэффициент: 2 }))
    const snap = await snapshot((url) => {
      if (url.includes('$orderby')) urls.push(url)
      return url.includes('$skip=0') ? Response.json({ value: full }) : Response.json({ value: [{ Owner_Key: G(1), Description: 'кор', Коэффициент: 10 }] })
    })
    expect(urls).toHaveLength(2)
    expect(urls[1]).toContain(`$skip=${ODATA_PAGE}`)
    expect(urls[0]).toContain('$select=Ref_Key,Owner_Key,Owner_Type,Description,DeletionMark')
    expect(snap.items[0]!.item.packLabel).toBe('кор')
  })

  it('1С не поняла $select — повтор без него', async () => {
    const urls: string[] = []
    const snap = await snapshot((url) => {
      if (url.includes('$orderby')) urls.push(url)
      return url.includes('$select') ? new Response('', { status: 400 }) : Response.json({ value: [{ Owner_Key: G(1), Description: 'уп', Коэффициент: 4 }] })
    })
    expect(urls).toHaveLength(2)
    expect(snap.items[0]!.item.packLabel).toBe('уп')
  })

  it('GUID товара в верхнем регистре находит упаковку', async () => {
    const snap = await snapshot(() => Response.json({ value: [{ Owner_Key: G(1).toUpperCase().replace('0000', 'ABCD'), Description: 'уп', Коэффициент: 4 }] }), undefined, G(1).toUpperCase().replace('0000', 'ABCD'))
    expect(snap.items[0]!.item.packLabel).toBe('уп')
  })

  it('без упаковок версия прежняя: только характеристики', async () => {
    const snap = await snapshot(() => Response.json({ value: [] }))
    const { createHash } = await import('node:crypto')
    expect(snap.items[0]!.version).toBe(`v1|${createHash('sha1').update(JSON.stringify({})).digest('hex').slice(0, 12)}`)
  })

  it('выбор упаковки: равная кратности, иначе самая большая, при равенстве — по названию', () => {
    const c = [{ factor: 144, label: 'кор' }, { factor: 12, label: 'уп' }]
    expect(choosePack(c, 12)).toBe('уп')
    expect(choosePack(c, 1)).toBe('кор')
    expect(choosePack([{ factor: 10, label: 'Б' }, { factor: 10, label: 'А' }], 1)).toBe('А')
    expect(choosePack([{ factor: 10, label: 'А' }, { factor: 10, label: 'Б' }], 1)).toBe('А')
    expect(choosePack([], 1)).toBeUndefined()
    // Подпись режется до 60 знаков; владелец — только номенклатура (окончание типа).
    const long = packLabels([{ Owner_Key: G(1), Description: 'x'.repeat(100), Коэффициент: 2 }])
    expect(long.get(G(1))).toHaveLength(60)
    expect(packLabels([{ Owner: G(2), Owner_Type: 'StandardODATA.Catalog_НоменклатураСпец', Description: 'уп', Коэффициент: 2 }]).size).toBe(0)
  })

  it('база хранит подпись и отдаёт её в каталоге', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const store = createCatalogStore(db)
    const item: ItemT = { guid: G(1), sku: 'B', name: 'Болт', sectionGuid: G(900), brand: '', unit: 'шт', packQty: 1, minQty: 1, packLabel: 'уп (12 шт)', description: '', properties: {}, images: [], analogs: [], changedAt: '2026-11-10T10:00:00.000Z', deleted: false }
    store.saveCatalog([{ guid: G(900), parentGuid: null, name: 'Крепёж' }], [item, { ...item, guid: G(2), packLabel: undefined }])
    expect(store.item(G(1))!.packLabel).toBe('уп (12 шт)')
    expect(store.item(G(2))!.packLabel).toBe('')
    // Повторное сохранение: подпись меняется и стирается (ON CONFLICT обновляет столбец).
    store.saveCatalog([], [{ ...item, packLabel: 'кор (144 шт)' }, { ...item, guid: G(2), packLabel: 'уп (6 шт)' }])
    expect(store.item(G(1))!.packLabel).toBe('кор (144 шт)')
    expect(store.item(G(2))!.packLabel).toBe('уп (6 шт)')
    store.saveCatalog([], [{ ...item, packLabel: undefined }])
    expect(store.item(G(1))!.packLabel).toBe('')
    expect(Object.fromEntries(storedPackLabels(db))).toEqual({ [G(2)]: 'уп (6 шт)' })
    // GUID в базе в верхнем регистре — ключ всё равно в нижнем, как ищет снимок.
    db.prepare(`UPDATE catalog_item SET guid = 'ABCDEF00-0000-0000-0000-000000000002' WHERE guid = ?`).run(G(2))
    expect(storedPackLabels(db).get('abcdef00-0000-0000-0000-000000000002')).toBe('уп (6 шт)')
  })
})
