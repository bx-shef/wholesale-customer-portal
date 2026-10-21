import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from '../server/db/sqlite'
import type { ODataClient } from '../server/services/onecOdata'
import { OdataOnec } from '../server/services/onecOdataSource'
import { sqliteVersionStore } from '../server/utils/odataVersions'
import { memorySyncStore, readByKey, runFlow } from '../server/utils/onecSync'
import type { ItemT, PriceT, SectionT } from '../shared/onec/schemas'

const G = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const item = (n: number): ItemT => ({ guid: G(n), sku: `S${n}`, name: `Товар ${n}`, sectionGuid: G(900), brand: '', unit: 'шт', packQty: 1, minQty: 1, description: '', properties: {}, images: [], analogs: [], changedAt: '', deleted: false })
const sections: SectionT[] = [{ guid: G(900), parentGuid: null, name: 'Краски' }]

function setup(over: Partial<ODataClient> = {}) {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  let clock = new Date('2026-10-21T10:00:00Z')
  const calls: string[] = []
  let versions: Record<number, string> = { 1: 'a', 2: 'a', 3: 'a' }
  const client = {
    async catalogSnapshot() {
      calls.push('catalog')
      return { sections, items: Object.entries(versions).map(([n, version]) => ({ item: item(Number(n)), version })) }
    },
    ...over,
  } as unknown as ODataClient
  const api = new OdataOnec(client, sqliteVersionStore(db), { now: () => clock })
  return {
    api, calls,
    tick: (ms: number) => { clock = new Date(clock.getTime() + ms) },
    setVersions: (v: Record<number, string>) => { versions = v },
  }
}

describe('OdataOnec: каталог по версиям', () => {
  it('первый прогон — всё; без изменений — только граница курсора; изменённая версия — только она', async () => {
    const t = setup()
    const store = memorySyncStore()
    const flow = { name: 'catalog', key: (i: ItemT) => i.guid, load: (p: object) => t.api.catalog(p), consume: async () => {} }
    expect((await runFlow(flow, store)).received).toBe(3)
    t.tick(10 * 60_000)
    // Граница `changedSince` включена (контракт §1.5): строки момента курсора приходят повторно.
    expect((await runFlow(flow, store)).received).toBe(3)
    t.tick(10 * 60_000)
    t.setVersions({ 1: 'a', 2: 'b', 3: 'a' })
    expect((await runFlow(flow, store)).received).toBe(3)
    t.tick(10 * 60_000)
    // Курсор ушёл на момент изменения товара 2: дальше приходит только он (граница).
    const got = await readByKey(flow, store.cursors.get('catalog')!)
    expect(got.map(i => i.guid)).toEqual([G(2)])
  })

  it('разделы — на первой странице; снимок один на прогон (TTL)', async () => {
    const t = setup()
    const p1 = await t.api.catalog({ pageSize: 2 })
    const p2 = await t.api.catalog({ page: 2, pageSize: 2 })
    expect(p1.sections).toEqual(sections)
    expect(p2.sections).toEqual([])
    expect([...p1.items, ...p2.items].map(i => i.guid)).toEqual([G(1), G(2), G(3)])
    expect(t.calls).toEqual(['catalog'])
    t.tick(3 * 60_000)
    await t.api.catalog({})
    expect(t.calls).toEqual(['catalog', 'catalog'])
  })
})

describe('OdataOnec: цены и остальное', () => {
  it('виды цен по наименованию → GUID; неизвестное имя — ошибка, не «все»', async () => {
    let asked: string[] | undefined
    const client = {
      names: async () => ({ map: new Map([[G(30), 'Прайс'], [G(31), 'Закупочная']]) }),
      prices: async (o: { priceTypes?: string[] }) => {
        asked = o.priceTypes
        const p: PriceT = { priceTypeGuid: G(30), itemGuid: G(1), price: 5, currency: 'BYN', vatRate: 20, changedAt: '2026-01-01T00:00:00+03:00', deleted: false }
        return { items: [p], via: 'slice', register: 'r', tried: [], stats: { zero: 0 }, missing: [] }
      },
    } as unknown as ODataClient
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const ok = new OdataOnec(client, sqliteVersionStore(db), { priceTypeNames: [' прайс '] })
    expect((await ok.prices({})).items).toHaveLength(1)
    expect(asked).toEqual([G(30)])
    const bad = new OdataOnec(client, sqliteVersionStore(db), { priceTypeNames: ['Нет такого'] })
    await expect(bad.prices({})).rejects.toMatchObject({ kind: 'contract' })
  })

  it('рейсы — честный отказ 501, не мок', async () => {
    const t = setup()
    await expect(t.api.trips({})).rejects.toMatchObject({ status: 501 })
    expect(t.api.stockIsSnapshot).toBe(true)
  })
})
