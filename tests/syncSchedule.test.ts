// Частота автосинхронизации — окружением, пауза — кнопкой (решение владельца 2026-10-23).
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../server/db/sqlite'
import { flowHealth, healthAlerts } from '../server/utils/syncHealth'
import { AUTO_FLOWS, autoSyncSkip, markAutoStart, everyFromEnv, isDue, parseEvery, readAutoSyncPaused, resetAutoSyncMemory, staleMsFor, writeAutoSyncPaused } from '../server/utils/syncSchedule'
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
  it('«давно не было» — не меньше трёх интервалов; только вручную — никогда', () => {
    expect(staleMsFor(60 * 60_000, 1440)).toBe(3 * 1440 * 60_000)
    expect(staleMsFor(60 * 60_000, 5)).toBe(60 * 60_000)
    expect(staleMsFor(60 * 60_000, 0)).toBe(Infinity)
    expect(staleMsFor(60 * 60_000, undefined)).toBe(60 * 60_000)
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
  it('каждая задача спрашивает autoSyncSkip своим потоком и выходит при пропуске; расписание будит все', () => {
    const flowOf: Record<string, string> = { catalog: 'catalog', prices: 'prices', stock: 'stock', clients: 'client_data', orders: 'orders', schedule: 'schedule', trips: 'trips', images: 'images' }
    const files = readdirSync('server/tasks/sync').map(f => f.replace(/\.ts$/, '')).sort()
    expect(files).toEqual(Object.keys(flowOf).sort())
    const config = readFileSync('nuxt.config.ts', 'utf8')
    const scheduled = /'\* \* \* \* \*': \[([^\]]+)\]/.exec(config)![1]!.match(/sync:\w+/g)!.map(s => s.slice(5)).sort()
    expect(scheduled).toEqual(files)
    for (const f of files) {
      const src = readFileSync(`server/tasks/sync/${f}.ts`, 'utf8')
      expect(src).toContain(`autoSyncSkip('${flowOf[f]}',`)
      expect(src).toContain('if (skip) return { result: skip }')
    }
  })

  it('выкат не будит все потоки: последний запуск — из журнала sync_run', () => {
    db.prepare("INSERT INTO sync_run (flow, status, started_at, received) VALUES ('prices', 'done', ?, 0)").run(new Date(0).toISOString())
    expect(autoSyncSkip('prices', { db, every, now: 60_000 })).toMatch(/not due/)
  })

  it('прогрев и кнопка отмечают запуск — расписание не повторяет его тут же', () => {
    markAutoStart('prices', 0)
    expect(autoSyncSkip('prices', { db, every, now: 60_000 })).toMatch(/not due/)
  })

  it('пауза не останавливает заявки (досылка в CRM)', () => {
    writeAutoSyncPaused(db, true, '2026-10-23T10:00:00.000Z')
    expect(autoSyncSkip('orders', { db, every, now: 0 })).toBeNull()
  })

  it('на паузе «давно не было» не тревожит, сбои — тревожат; поток только вручную не «давно не было»', () => {
    const old = { flow: 'prices', status: 'done', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:00Z', received: 1, error: null }
    const stale = flowHealth('prices', [old], Date.parse('2026-10-23T00:00:00Z'), 1e12)
    expect(stale.state).toBe('stale')
    expect(healthAlerts([stale], { pausedUntil: 0 }, 0, true)).toEqual([])
    expect(healthAlerts([stale], { pausedUntil: 0 }, 0, false)).toHaveLength(1)
    expect(flowHealth('prices', [old], Date.parse('2026-10-23T00:00:00Z'), 1e12, staleMsFor(60 * 60_000, 0)).state).toBe('ok')
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

describe('очистка данных мока перед выгрузкой из 1С', () => {
  it('стирает данные обмена и их курсоры, заявки и чужие курсоры не трогает', async () => {
    const { resetSyncData } = await import('../server/utils/resetSyncData')
    const db = new DatabaseSync(':memory:')
    migrate(db)
    db.exec("INSERT INTO catalog_section (guid, parent_guid, name) VALUES ('s', NULL, 'Раздел')")
    db.exec("INSERT INTO sync_cursor (flow, cursor, updated_at) VALUES ('catalog', 'x', 'x'), ('orders', 'y', 'y')")
    const removed = resetSyncData(db)
    expect(removed.catalog_section).toBe(1)
    expect(db.prepare('SELECT count(*) AS n FROM catalog_section').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT flow FROM sync_cursor').all().map(r => (r as { flow: string }).flow)).toEqual(['orders'])
  })
})

describe('прогоны, прерванные перезапуском', () => {
  it('«идёт» после старта становится «ошибка: прервано», завершённые не трогаем', async () => {
    const { closeInterruptedRuns } = await import('../server/utils/onecSync')
    const db = new DatabaseSync(':memory:')
    migrate(db)
    db.exec("INSERT INTO sync_run (flow, status, started_at, received) VALUES ('prices', 'running', 'a', 0), ('catalog', 'done', 'b', 5)")
    expect(closeInterruptedRuns(db, 'c')).toBe(1)
    expect(db.prepare('SELECT flow, status, finished_at AS f FROM sync_run ORDER BY flow').all()).toEqual([{ flow: 'catalog', status: 'done', f: null }, { flow: 'prices', status: 'failed', f: 'c' }])
  })
})

describe('прайс 1С: только нужные поля', () => {
  it('slimPriceRow отбрасывает лишние поля, оставляет поля цены', async () => {
    const { slimPriceRow } = await import('../server/services/onecOdata')
    const slim = slimPriceRow({ Номенклатура_Key: 'a', ВидЦены_Key: 'b', Цена: 1, Recorder: 'x', LineNumber: '1' } as never)
    expect(slim).toEqual({ Номенклатура_Key: 'a', ВидЦены_Key: 'b', Цена: 1 })
  })
})
