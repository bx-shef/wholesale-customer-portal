import { describe, expect, it } from 'vitest'
import { memorySyncStore, readByKey, runFlow, type FlowDefinition } from '../server/utils/onecSync'
import { createMockState, handleMockRequest } from '../server/mocks/onec/mock'
import { mockFetch } from '../server/mocks/onec/fetch'
import { OnecClient } from '../server/services/onec'
import type { ClientT } from '../shared/onec/schemas'

function setup() {
  const state = createMockState('t')
  let now = Date.parse('2026-10-11T10:00:00Z')
  const client = new OnecClient({ baseUrl: 'http://m/mock-1c', token: 't', fetch: mockFetch(state, () => now), sleep: async () => {} })
  const store = memorySyncStore()
  const seen: ClientT[][] = []
  const flow: FlowDefinition<ClientT> = { name: 'clients', load: p => client.clients(p), key: c => c.guid, consume: async (items) => { seen.push(items) } }
  return { state, client, store, seen, flow, tick: (ms: number) => { now += ms }, nowMs: () => now }
}

describe('runFlow', () => {
  it('первый запуск — всё, второй — только граница курсора; курсор = наибольший changedAt источника', async () => {
    const { store, seen, flow, state } = setup()
    const first = await runFlow(flow, store)
    expect(first).toMatchObject({ status: 'done', received: 5, cursorFrom: null })
    const newest = state.data.clients.map(c => c.changedAt).sort().at(-1)
    expect(store.cursors.get('clients')).toBe(newest)
    const second = await runFlow(flow, store)
    // Граница включительна: запись с changedAt = курсор приходит снова, потребитель идемпотентен.
    expect(second).toMatchObject({ status: 'done', received: 1, cursorFrom: newest, cursorTo: newest })
    expect(seen.map(b => b.length)).toEqual([5, 1])
  })

  it('новый клиент в 1С приходит следующим запуском — и только он', async () => {
    const { store, flow, state, seen, tick, nowMs } = setup()
    await runFlow(flow, store)
    tick(60_000)
    handleMockRequest(state, { method: 'POST', path: '/_admin/client', query: {}, body: { name: 'ООО «Новичок»' }, authorization: 'Bearer t' }, nowMs())
    const run = await runFlow(flow, store)
    expect(seen.at(-1)!.map(c => c.name)).toContain('ООО «Новичок»')
    expect(run.received).toBe(2)
    expect(store.cursors.get('clients')).toBe(new Date(nowMs()).toISOString())
  })

  it('потребитель упал — курсор на месте, запуск помечен failed с причиной', async () => {
    const { store, flow } = setup()
    const failing = { ...flow, consume: async () => { throw new Error('Б24 недоступен') } }
    const run = await runFlow(failing, store)
    expect(run).toMatchObject({ status: 'failed', error: 'Error: Б24 недоступен' })
    expect(store.cursors.has('clients')).toBe(false)
    expect(store.runs.map(r => r.status)).toEqual(['failed'])
  })

  it('1С недоступна — failed, курсор не двигается', async () => {
    const { store, flow, state } = setup()
    state.mode.failNext = 10
    const run = await runFlow(flow, store)
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/HTTP 503/)
    expect(store.cursors.size).toBe(0)
  })
})


describe('readByKey', () => {
  type Row = { guid: string, changedAt: string }
  const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString()

  /** Источник «как 1С»: сортировка по changedAt+guid, страницы по номеру, граница включительно. */
  function source(rows: Row[], pageSize: number) {
    return {
      key: (r: Row) => r.guid,
      load: async ({ page = 1, changedSince }: { page?: number, changedSince?: string }) => {
        const all = rows
          .filter(r => !changedSince || r.changedAt >= changedSince)
          .sort((a, b) => a.changedAt.localeCompare(b.changedAt) || a.guid.localeCompare(b.guid))
        const start = (page - 1) * pageSize
        return { items: all.slice(start, start + pageSize), nextPage: start + pageSize < all.length ? page + 1 : null }
      },
    }
  }

  it('запись, изменённая во время чтения, не выбивает соседей со страницы', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ guid: `g${i}`, changedAt: at(i) }))
    const src = source(rows, 2)
    let calls = 0
    const flow = {
      key: src.key,
      load: async (p: { page?: number, changedSince?: string }) => {
        // После первой страницы в 1С меняется уже прочитанная g0 — она уезжает в хвост.
        if (calls++ === 1) rows[0]!.changedAt = at(100)
        return src.load(p)
      },
    }
    const got = await readByKey(flow, null)
    expect(new Set(got.map(r => r.guid))).toEqual(new Set(['g0', 'g1', 'g2', 'g3', 'g4', 'g5']))
  })

  it('группа с одним моментом больше страницы читается целиком и не зацикливается', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ guid: `g${i}`, changedAt: at(1) }))
    const got = await readByKey(source(rows, 3), null)
    expect(got.map(r => r.guid).sort()).toEqual(rows.map(r => r.guid))
  })
})

describe('runFlow — отказ на середине чтения', () => {
  it('503 на второй странице — курсор не двигается', async () => {
    const store = memorySyncStore()
    let n = 0
    const flow: FlowDefinition<{ guid: string, changedAt: string }> = {
      name: 'x',
      key: r => r.guid,
      load: async () => {
        if (n++ === 1) throw new Error('HTTP 503')
        return { items: [{ guid: 'a', changedAt: '2026-01-01T00:00:01.000Z' }], nextPage: 2 }
      },
      consume: async () => {},
    }
    expect((await runFlow(flow, store)).status).toBe('failed')
    expect(store.cursors.size).toBe(0)
  })
})
