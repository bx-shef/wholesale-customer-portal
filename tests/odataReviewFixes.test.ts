// Тесты по находкам ревью PR #62: каждое правило — отдельно, чтобы мутация роняла ровно его.
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { migrate } from '../server/db/sqlite'
import type { ODataClient } from '../server/services/onecOdata'
import { ODATA_UNSUPPORTED_FLOWS, OdataOnec } from '../server/services/onecOdataSource'
import { parseOnecMode } from '../server/utils/env'
import { shouldPruneStock, snapshotPage, stampByVersion } from '../server/utils/odataSnapshot'
import { sqliteVersionStore } from '../server/utils/odataVersions'
import { activeFlows, FLOWS } from '../server/utils/syncHealth'
import type { PriceT, StockT } from '../shared/onec/schemas'

const G = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const db = () => { const d = new DatabaseSync(':memory:'); migrate(d); return d }

describe('shouldPruneStock', () => {
  const ok = { snapshot: true, status: 'done', received: 10, cursorTo: '2026-10-21T00:00:00Z', storedRows: 20 }
  it('чистим только после удачного непустого снимка не меньше половины', () => {
    expect(shouldPruneStock(ok)).toBe(true)
    expect(shouldPruneStock({ ...ok, snapshot: false })).toBe(false)
    expect(shouldPruneStock({ ...ok, status: 'failed' })).toBe(false)
    expect(shouldPruneStock({ ...ok, received: 0, storedRows: 0 })).toBe(false)
    expect(shouldPruneStock({ ...ok, cursorTo: null })).toBe(false)
    expect(shouldPruneStock({ ...ok, storedRows: 21 })).toBe(false)
  })
})

describe('sqliteVersionStore', () => {
  it('обновляет версию и разделяет виды', () => {
    const s = sqliteVersionStore(db())
    s.put('item', [{ key: 'a', version: '1', changedAt: 't1' }])
    s.put('price', [{ key: 'a', version: 'p', changedAt: 'tp' }])
    s.put('item', [{ key: 'a', version: '2', changedAt: 't2' }])
    expect(s.get('item').get('a')).toEqual({ version: '2', changedAt: 't2' })
    expect(s.get('price').get('a')).toEqual({ version: 'p', changedAt: 'tp' })
    expect(s.get('stock').size).toBe(0)
  })
})

describe('snapshotPage и stampByVersion: края', () => {
  it('равные моменты — порядок по ключу, а не по входу', () => {
    const rows = [{ k: 'c', changedAt: 't' }, { k: 'a', changedAt: 't' }, { k: 'b', changedAt: 't' }]
    expect(snapshotPage(rows, r => r.k).items.map(r => r.k)).toEqual(['a', 'b', 'c'])
  })
  it('пустая версия — всегда сейчас и без записи', () => {
    const r = stampByVersion([{ key: 'a', version: '', row: { changedAt: '' } }], new Map([['a', { version: '', changedAt: 'old' }]]), 'now')
    expect(r.rows[0]!.changedAt).toBe('now')
    expect(r.updates).toEqual([])
  })
})

describe('OdataOnec: снимок, цены, остатки', () => {
  it('ошибка снимка не кэшируется', async () => {
    let calls = 0
    const client = { stock: async () => { calls++; if (calls === 1) throw new Error('boom'); return [] } } as unknown as ODataClient
    const api = new OdataOnec(client, sqliteVersionStore(db()))
    await expect(api.stock({})).rejects.toThrow('boom')
    await expect(api.stock({})).resolves.toMatchObject({ items: [] })
    expect(calls).toBe(2)
  })

  it('остатки — страницами из снимка', async () => {
    const s = (n: number): StockT => ({ itemGuid: G(n), warehouseGuid: G(100), qty: n, changedAt: '2026-10-21T00:00:00Z' } as StockT)
    const client = { stock: async () => [s(2), s(1)] } as unknown as ODataClient
    const api = new OdataOnec(client, sqliteVersionStore(db()))
    const p = await api.stock({ pageSize: 1 })
    expect(p.items.map(x => x.itemGuid)).toEqual([G(1)])
    expect(p.nextPage).toBe(2)
  })

  it('цена задним числом (Period не новее) — всё равно изменение', async () => {
    let clock = new Date('2026-10-21T10:00:00Z')
    let price = 5
    const p = (): PriceT => ({ priceTypeGuid: G(30), itemGuid: G(1), price, currency: 'BYN', vatRate: 20, changedAt: '2026-01-01T00:00:00+03:00', deleted: false })
    const client = { prices: async () => ({ items: [p()], via: 'slice', register: 'r', tried: [], stats: { zero: 0 }, missing: [] }) } as unknown as ODataClient
    const api = new OdataOnec(client, sqliteVersionStore(db()), { now: () => clock, ttlMs: 0 })
    const first = (await api.prices({})).items[0]!.changedAt
    clock = new Date('2026-10-21T11:00:00Z')
    expect((await api.prices({})).items[0]!.changedAt).toBe(first)
    price = 6
    clock = new Date('2026-10-21T12:00:00Z')
    expect((await api.prices({})).items[0]!.changedAt).toBe('2026-10-21T12:00:00.000Z')
  })
})

describe('потоки и режим', () => {
  it('activeFlows убирает только неподдержанные', () => {
    expect(activeFlows()).toEqual(Object.keys(FLOWS))
    expect([...activeFlows(ODATA_UNSUPPORTED_FLOWS)].sort()).toEqual(['catalog', 'clients', 'orders', 'prices', 'stock'])
    expect(activeFlows(ODATA_UNSUPPORTED_FLOWS)).not.toContain('trips')
  })
  it('parseOnecMode: odata, по умолчанию http, неизвестное — предупреждение', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseOnecMode(' OData ')).toBe('odata')
    expect(parseOnecMode('')).toBe('http')
    expect(warn).not.toHaveBeenCalled()
    expect(parseOnecMode('soap')).toBe('http')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})

describe('ODataClient: пределы ответа и запрос каталога', async () => {
  const { ODataClient, ODATA_PAGE, readBodyLimited } = await import('../server/services/onecOdata')
  const mk = (fake: typeof fetch) => new ODataClient({ baseUrl: 'https://x', auth: { kind: 'bearer', token: 't' }, fetch: fake })

  it('readBodyLimited считает байты и обрывает поток', async () => {
    const stream = (parts: string[]) => new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close() } }))
    expect(await readBodyLimited(stream(['ab', 'вг']), 6)).toBe('abвг')
    // «вг» — 4 байта, а не 2 символа: предел в байтах.
    expect(await readBodyLimited(stream(['ab', 'вг']), 5)).toBeNull()
  })

  it('content-length больше предела — ошибка contract до чтения тела', async () => {
    await expect(mk(async () => new Response('{"value":[]}', { headers: { 'content-length': String(100 * 1048576) } })).catalogSnapshot()).rejects.toMatchObject({ kind: 'contract' })
  })

  it('каталог: только товары (IsFolder eq false), порядок по Ref_Key, предел страниц', async () => {
    const urls: string[] = []
    const fake: typeof fetch = async (u) => {
      const url = decodeURIComponent(String(u))
      urls.push(url)
      if (url.includes('Catalog_Номенклатура?')) return Response.json({ value: Array.from({ length: ODATA_PAGE }, (_, i) => ({ Ref_Key: G(i), Description: 'т' })) })
      return Response.json({ value: [] })
    }
    const c = new ODataClient({ baseUrl: 'https://x', auth: { kind: 'bearer', token: 't' }, fetch: fake, maxPages: 3 })
    await expect(c.catalogSnapshot()).rejects.toMatchObject({ kind: 'contract' })
    const goods = urls.filter(u => u.includes('Catalog_Номенклатура?'))
    expect(goods).toHaveLength(3)
    expect(goods[0]).toContain('$filter=IsFolder eq false')
    expect(goods[0]).toContain('$orderby=Ref_Key')
    expect(goods[1]).toContain(`$skip=${ODATA_PAGE}`)
  })
})

describe('applyStockSnapshot', async () => {
  const { applyStockSnapshot } = await import('../server/utils/catalogSync')
  const run = { status: 'done', received: 3, cursorTo: '2026-10-21T10:00:00.000Z' } as const
  it('снимок прошёл правило — удаляем старше снимка; нет — оставляем', () => {
    const asked: string[] = []
    const catalog = { pruneStockBefore: (at: string) => { asked.push(at); return 1 } }
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(applyStockSnapshot(run, { snapshot: true, storedRows: 4, catalog })).toBe(1)
    expect(asked).toEqual([run.cursorTo])
    expect(applyStockSnapshot({ ...run, received: 1 }, { snapshot: true, storedRows: 4, catalog })).toBe(0)
    expect(warn).toHaveBeenCalledOnce()
    expect(applyStockSnapshot(run, { snapshot: false, storedRows: 4, catalog })).toBe(0)
    expect(asked).toHaveLength(1)
    vi.restoreAllMocks()
  })
})
