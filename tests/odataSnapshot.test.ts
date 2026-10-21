import { describe, expect, it } from 'vitest'
import { snapshotPage, stampByVersion } from '../server/utils/odataSnapshot'
import { readByKey } from '../server/utils/onecSync'

type Row = { id: string, changedAt: string }
const key = (r: Row) => r.id

describe('snapshotPage', () => {
  const rows: Row[] = [
    { id: 'c', changedAt: '2026-01-02T00:00:00Z' },
    { id: 'a', changedAt: '2026-01-01T00:00:00Z' },
    { id: 'b', changedAt: '2026-01-01T00:00:00Z' },
  ]

  it('по возрастанию момента, при равенстве — по ключу; граница включена; страницы', () => {
    expect(snapshotPage(rows, key, { pageSize: 2 })).toEqual({ items: [rows[1], rows[2]], nextPage: 2 })
    expect(snapshotPage(rows, key, { pageSize: 2, page: 2 })).toEqual({ items: [rows[0]], nextPage: null })
    expect(snapshotPage(rows, key, { changedSince: '2026-01-02T00:00:00Z' }).items.map(key)).toEqual(['c'])
    expect(snapshotPage(rows, key, { changedSince: '2026-02-01T00:00:00Z' })).toEqual({ items: [], nextPage: null })
  })

  it('синхронизация по курсору читает снимок целиком и без повторов', async () => {
    const many: Row[] = Array.from({ length: 1203 }, (_, i) => ({ id: String(i).padStart(5, '0'), changedAt: `2026-01-0${1 + (i % 3)}T00:00:00Z` }))
    const got = await readByKey({ key, load: p => Promise.resolve(snapshotPage(many, key, p)) }, null)
    expect(got).toHaveLength(1203)
    expect(new Set(got.map(key)).size).toBe(1203)
    const after = await readByKey({ key, load: p => Promise.resolve(snapshotPage(many, key, p)) }, '2026-01-03T00:00:00Z')
    expect(after).toHaveLength(401)
  })
})

describe('stampByVersion', () => {
  it('та же версия — прежний момент; новая или неизвестная — сейчас, и в хранилище', () => {
    const prev = new Map([['a', { version: 'v1', changedAt: '2026-01-01T00:00:00Z' }], ['b', { version: 'v1', changedAt: '2026-01-01T00:00:00Z' }]])
    const now = '2026-02-01T00:00:00Z'
    const r = stampByVersion([
      { key: 'a', version: 'v1', row: { id: 'a', changedAt: '' } },
      { key: 'b', version: 'v2', row: { id: 'b', changedAt: '' } },
      { key: 'c', version: 'v1', row: { id: 'c', changedAt: '' } },
    ], prev, now)
    expect(r.rows.map(x => x.changedAt)).toEqual(['2026-01-01T00:00:00Z', now, now])
    expect(r.updates).toEqual([{ key: 'b', version: 'v2', changedAt: now }, { key: 'c', version: 'v1', changedAt: now }])
  })
})
