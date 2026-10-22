// Данные клиента из 1С по GUID: кэш со сроком свежести, работа по кэшу при сбое 1С, расписание, экран.
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from '../server/db/sqlite'
import { createClientLoader, FORCE_MIN_MS, NEGATIVE_TTL_MS } from '../server/utils/clientLoader'
import { createClientStore } from '../server/utils/clients'
import { refreshSeenClients, REFRESH_BATCH } from '../server/utils/clientRefresh'
import { memorySyncStore } from '../server/utils/onecSync'
import { clientDataView, isClientRoute, NO_CONTRACT_MESSAGE } from '../shared/clientData'
import type { ClientT } from '../shared/onec/schemas'

const G = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const T0 = Date.parse('2026-10-22T09:00:00Z')
const MIN = 60_000
const client = (n: number, contract = true): ClientT => ({
  guid: G(n), name: `Клиент ${n}`, unp: '', address: '', city: '', region: null, shipmentBlocked: false, managerEmail: '',
  contract: contract ? { guid: G(100 + n), number: 'С-1', date: '2026-01-01', priceTypeGuid: G(30), paymentDelayDays: 0, creditLimit: 0, debt: 0, currency: 'BYN' } : null,
  deliveryAddresses: [], changedAt: '2026-10-22T09:00:00+03:00', deleted: false,
})

function setup(load: (guid: string) => Promise<ClientT | null>) {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  const store = createClientStore(db)
  let now = T0
  const fails: Array<{ guid: string, cached: boolean, scheduled?: boolean }> = []
  const loader = createClientLoader({ store, load, ttlMs: 15 * MIN, now: () => new Date(now), onFail: (guid, _e, cached, scheduled) => fails.push(scheduled ? { guid, cached, scheduled } : { guid, cached }) })
  return { store, loader, fails, tick: (ms: number) => { now += ms } }
}

describe('createClientLoader', () => {
  it('первый вход — из 1С; свежий кэш — без 1С; старше срока — снова из 1С', async () => {
    let calls = 0
    const s = setup(async g => { calls++; return client(Number(g.slice(-3))) })
    expect((await s.loader.ensure(G(1))).status).toBe('loaded')
    s.tick(14 * MIN)
    expect((await s.loader.ensure(G(1))).status).toBe('fresh')
    expect(calls).toBe(1)
    s.tick(2 * MIN)
    expect((await s.loader.ensure(G(1))).status).toBe('loaded')
    expect(calls).toBe(2)
    // «Повторить» сразу после загрузки в 1С не идёт.
    expect((await s.loader.ensure(G(1), { force: true })).status).toBe('fresh')
    s.tick(FORCE_MIN_MS)
    expect((await s.loader.ensure(G(1), { force: true })).status).toBe('loaded')
    expect(calls).toBe(3)
  })

  it('«нет в 1С» и сбой без кэша помнятся NEGATIVE_TTL_MS — перезагрузка страницы в 1С не идёт; расписание — идёт', async () => {
    let calls = 0
    const s = setup(async () => { calls++; return null })
    expect((await s.loader.ensure(G(5))).status).toBe('missing')
    expect((await s.loader.ensure(G(5))).status).toBe('missing')
    expect(calls).toBe(1)
    await s.loader.ensure(G(5), { scheduled: true })
    expect(calls).toBe(2)
    s.tick(NEGATIVE_TTL_MS)
    await s.loader.ensure(G(5))
    expect(calls).toBe(3)
  })

  it('«Повторить» не прилипает к идущей обычной загрузке', async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const s = setup(async () => { calls++; await gate; return client(1) })
    const a = s.loader.ensure(G(1))
    const b = s.loader.ensure(G(1), { force: true })
    release()
    await Promise.all([a, b])
    expect(calls).toBe(2)
  })

  it('1С упала: есть кэш — работаем по нему с датой; нет кэша — ошибка и сигнал без кэша', async () => {
    let up = true
    const s = setup(async g => { if (!up) throw new Error('1C down'); return client(Number(g.slice(-3))) })
    await s.loader.ensure(G(1))
    up = false
    s.tick(20 * MIN)
    const stale = await s.loader.ensure(G(1))
    expect(stale.status).toBe('stale')
    expect(stale.loadedAt).toBe(new Date(T0).toISOString())
    expect(stale.client?.contractGuid).toBe(G(101))
    const none = await s.loader.ensure(G(2))
    expect(none).toMatchObject({ status: 'error', client: null })
    expect(s.fails).toEqual([{ guid: G(1), cached: true }, { guid: G(2), cached: false }])
    await s.loader.ensure(G(3), { scheduled: true })
    expect(s.fails.at(-1)).toEqual({ guid: G(3), cached: false, scheduled: true })
  })

  it('клиента нет в 1С — missing, кэш не пишется; один GUID — одна загрузка за раз', async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const s = setup(async (g) => {
      calls++
      await gate
      return g === G(1) ? client(1) : null
    })
    const a = s.loader.ensure(G(1))
    const b = s.loader.ensure(G(1))
    release()
    expect((await a).status).toBe('loaded')
    expect((await b).status).toBe('loaded')
    expect(calls).toBe(1)
    expect((await s.loader.ensure(G(9))).status).toBe('missing')
    expect(s.store.get(G(9))).toBeNull()
  })
})

describe('refreshSeenClients — расписание', () => {
  it('только заходившие за 30 дней и устаревшие; запуск — в журнал потока «клиенты»', async () => {
    const loaded: string[] = []
    const s = setup(async (g) => { loaded.push(g); return client(Number(g.slice(-3))) })
    await s.loader.ensure(G(1))
    await s.loader.ensure(G(2))
    await s.loader.ensure(G(3), { seen: false })
    s.tick(20 * MIN)
    loaded.length = 0
    const runs = memorySyncStore()
    const r = await refreshSeenClients({ loader: s.loader, store: s.store, runs, ttlMs: 15 * MIN, now: () => new Date(T0 + 20 * MIN) })
    expect(r).toEqual({ due: 2, loaded: 2, failed: 0 })
    expect(loaded.sort()).toEqual([G(1), G(2)])
    expect(runs.runs.at(-1)).toMatchObject({ flow: 'client_data', status: 'done', received: 2 })
    // Заходил 31 день назад — не трогаем.
    expect(s.store.due(new Date(T0 + 32 * 86_400_000 - 30 * 86_400_000).toISOString(), new Date(T0 + 40 * MIN).toISOString(), REFRESH_BATCH)).toEqual([])
  })

  it('все загрузки упали — запуск со сбоем (уходит в оповещения)', async () => {
    let up = true
    const s = setup(async g => { if (!up) throw new Error('down'); return client(Number(g.slice(-3))) })
    await s.loader.ensure(G(1))
    up = false
    s.tick(20 * MIN)
    const runs = memorySyncStore()
    const r = await refreshSeenClients({ loader: s.loader, store: s.store, runs, ttlMs: 15 * MIN, now: () => new Date(T0 + 20 * MIN) })
    expect(r.failed).toBe(1)
    expect(runs.runs.at(-1)).toMatchObject({ flow: 'client_data', status: 'failed' })
  })
})

describe('экран данных клиента', () => {
  it('страницы клиента — да; вход, справка, коробка — нет', () => {
    for (const p of ['/', '/cart', '/orders', '/profile', '/product/x']) expect(isClientRoute(p), p).toBe(true)
    for (const p of ['/login', '/help', '/b24/app', '/products']) expect(isClientRoute(p), p).toBe(false)
  })

  it('ошибка без кэша, не найден, сбой CRM — кабинет закрыт с «Повторить»; по кэшу — плашка с датой; без соглашения — к менеджеру', () => {
    for (const status of ['error', 'missing', 'crm_unavailable'] as const) expect(clientDataView({ status, loadedAt: null, hasContract: false })).toMatchObject({ block: true, retry: true })
    expect(clientDataView({ status: 'fresh', loadedAt: '2026-10-22T06:00:00Z', hasContract: true })).toEqual({ block: false, message: '', retry: false })
    expect(clientDataView({ status: 'stale', loadedAt: '2026-10-22T06:05:00Z', hasContract: true }).message).toBe('Учётная система не отвечает: данные на 22.10, 09:05.')
    expect(clientDataView({ status: 'loaded', loadedAt: '2026-10-22T06:00:00Z', hasContract: false })).toEqual({ block: false, message: NO_CONTRACT_MESSAGE, retry: false })
    expect(NO_CONTRACT_MESSAGE).toContain('Обратитесь к менеджеру')
  })
})
