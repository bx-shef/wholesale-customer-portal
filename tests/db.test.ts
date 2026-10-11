import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { migrate, MIGRATIONS, openDatabase } from '../server/db/sqlite'
import { runFlow, sqliteSyncStore } from '../server/utils/onecSync'

describe('миграции', () => {
  it('применяются один раз: повторный старт ничего не ломает', () => {
    const db = new DatabaseSync(':memory:')
    expect(migrate(db)).toBe(MIGRATIONS.length)
    expect(migrate(db)).toBe(MIGRATIONS.length)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(MIGRATIONS.length)
  })
})

describe('откат миграции', () => {
  it('битая миграция не меняет ни версию, ни схему', () => {
    const db = new DatabaseSync(':memory:')
    const bad = ['CREATE TABLE ok_a (id INTEGER)', 'CREATE TABLE half (id INTEGER); SELECT * FROM nowhere']
    expect(() => migrate(db, bad)).toThrow()
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get()).toBeUndefined()
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ok_a'").get()).toBeTruthy()
  })
})

describe('sqliteSyncStore', () => {
  it('курсор и журнал переживают «перезапуск» — новое подключение к тому же файлу', async () => {
    const dir = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'wcp-'))
    const file = `${dir}/t.sqlite`
    const flow = {
      name: 'clients',
      key: (r: { guid: string }) => r.guid,
      load: async () => ({ items: [{ guid: 'a', changedAt: '2026-01-02T00:00:00.000Z' }], nextPage: null }),
      consume: async () => {},
    }
    const first = openDatabase(file)
    await runFlow(flow, sqliteSyncStore(first))
    first.close()

    const second = openDatabase(file)
    const store = sqliteSyncStore(second)
    expect(await store.getCursor('clients')).toBe('2026-01-02T00:00:00.000Z')
    const runs = second.prepare('SELECT status, received FROM sync_run').all()
    expect(runs).toEqual([{ status: 'done', received: 1 }])
  })
})
