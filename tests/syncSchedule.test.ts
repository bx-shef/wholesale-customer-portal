// Частота автосинхронизации — окружением, пауза — кнопкой (решение владельца 2026-10-23).
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../server/db/sqlite'
import { AUTO_FLOWS, autoSyncSkip, everyFromEnv, isDue, parseEvery, readAutoSyncPaused, resetAutoSyncMemory, staleMsFor, writeAutoSyncPaused } from '../server/utils/syncSchedule'
import { checkCompanyGuids } from '../server/utils/guidCheck'

describe('частота из окружения', () => {
  it('пусто — по умолчанию, 0 — только вручную, кривое — по умолчанию', () => {
    expect(parseEvery('', 15)).toBe(15)
    expect(parseEvery(' 1440 ', 15)).toBe(1440)
    expect(parseEvery('0', 15)).toBe(0)
    for (const bad of ['-1', '1.5', 'abc', '999999']) expect(parseEvery(bad, 15)).toBe(15)
  })
  it('все потоки читаются из своих переменных', () => {
    const every = everyFromEnv(n => (n === 'SYNC_PRICES_EVERY_MIN' ? '1440' : undefined))
    expect(every.prices).toBe(1440)
    expect(every.catalog).toBe(AUTO_FLOWS.catalog.every)
    const example = readFileSync('.env.example', 'utf8')
    for (const def of Object.values(AUTO_FLOWS)) expect(example).toContain(`${def.env}=`)
  })
  it('пора ли: 0 — никогда, первый раз — сразу, иначе по интервалу с допуском 30 с', () => {
    expect(isDue(undefined, 0, 0)).toBe(false)
    expect(isDue(undefined, 15, 0)).toBe(true)
    expect(isDue(0, 15, 14 * 60_000)).toBe(false)
    expect(isDue(0, 15, 15 * 60_000 - 20_000)).toBe(true)
  })
  it('«давно не было» — не меньше трёх интервалов', () => {
    expect(staleMsFor(60 * 60_000, 1440)).toBe(3 * 1440 * 60_000)
    expect(staleMsFor(60 * 60_000, 5)).toBe(60 * 60_000)
    expect(staleMsFor(60 * 60_000, 0)).toBe(60 * 60_000)
  })
})

describe('пауза и решение задачи', () => {
  let db: DatabaseSync
  const every = { ...everyFromEnv(() => undefined), prices: 15 }
  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    migrate(db)
    resetAutoSyncMemory()
  })
  it('пауза хранится в базе и останавливает все потоки, снятие — возобновляет', () => {
    expect(readAutoSyncPaused(db).paused).toBe(false)
    writeAutoSyncPaused(db, true, '2026-10-23T10:00:00.000Z')
    expect(readAutoSyncPaused(db)).toEqual({ paused: true, since: '2026-10-23T10:00:00.000Z' })
    expect(autoSyncSkip('prices', { db, every, now: 0 })).toMatch(/paused/)
    writeAutoSyncPaused(db, false, '2026-10-23T10:05:00.000Z')
    expect(autoSyncSkip('prices', { db, every, now: 0 })).toBeNull()
  })
  it('после запуска следующий — только через интервал; 0 — никогда сам', () => {
    expect(autoSyncSkip('prices', { db, every, now: 0 })).toBeNull()
    expect(autoSyncSkip('prices', { db, every, now: 60_000 })).toMatch(/not due/)
    expect(autoSyncSkip('prices', { db, every, now: 15 * 60_000 })).toBeNull()
    expect(autoSyncSkip('stock', { db, every: { ...every, stock: 0 }, now: 0 })).toMatch(/off/)
  })
  it('задачи расписания спрашивают autoSyncSkip, расписание будит раз в минуту', () => {
    for (const f of ['catalog', 'prices', 'stock', 'clients', 'orders', 'schedule', 'trips']) {
      expect(readFileSync(`server/tasks/sync/${f}.ts`, 'utf8')).toContain('autoSyncSkip(')
    }
    expect(readFileSync('nuxt.config.ts', 'utf8')).toContain("'* * * * *': ['sync:catalog'")
  })
})

describe('сверка компаний коробки с 1С', () => {
  const G = '3fbebdf8-bd8b-11f1-b86f-00155d008d05'
  it('только связь обмена 1С; есть с соглашением / без / нет / ошибка 1С', async () => {
    const call = async () => ({ items: [
      { id: 1, title: 'А', originatorId: 'ONE_C', originId: G },
      { id: 2, title: 'Б', originatorId: 'ONE_C', originId: G.replace('3f', '4f') },
      { id: 3, title: 'В', originatorId: 'ONE_C', originId: G.replace('3f', '5f') },
      { id: 4, title: 'Г', originatorId: 'OTHER', originId: G },
      { id: 5, title: 'Д', originatorId: 'ONE_C', originId: G.replace('3f', '6f') },
      { id: 6, title: 'Е', originatorId: 'ONE_C', originId: G },
    ] })
    const byGuid = async (g: string) => {
      if (g === G) return { contract: { guid: 'x' } } as never
      if (g.startsWith('4f')) return { contract: null } as never
      if (g.startsWith('6f')) throw new Error('timeout')
      return null
    }
    const rows = await checkCompanyGuids(call, byGuid)
    expect(rows.map(r => [r.companyId, r.onec])).toEqual([[1, 'found'], [2, 'no-contract'], [3, 'missing'], [4, 'missing'], [5, 'error']])
    expect(rows[3]!.guid).toBeNull()
  })
})
