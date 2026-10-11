import { describe, expect, it } from 'vitest'
import { memorySyncStore, runFlow, type FlowDefinition } from '../server/utils/onecSync'
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
  const flow: FlowDefinition<ClientT> = { name: 'clients', load: p => client.clients(p), consume: async (items) => { seen.push(items) } }
  return { state, client, store, seen, flow, tick: (ms: number) => { now += ms }, nowMs: () => now }
}

describe('runFlow', () => {
  it('первый запуск — всё, второй — ничего, курсор = наибольший changedAt источника', async () => {
    const { store, seen, flow, state } = setup()
    const first = await runFlow(flow, store)
    expect(first).toMatchObject({ status: 'done', received: 5, cursorFrom: null })
    const newest = state.data.clients.map(c => c.changedAt).sort().at(-1)
    expect(store.cursors.get('clients')).toBe(newest)
    const second = await runFlow(flow, store)
    expect(second).toMatchObject({ status: 'done', received: 0, cursorFrom: newest, cursorTo: newest })
    expect(seen.map(b => b.length)).toEqual([5, 0])
  })

  it('новый клиент в 1С приходит следующим запуском — и только он', async () => {
    const { store, flow, state, seen, tick, nowMs } = setup()
    await runFlow(flow, store)
    tick(60_000)
    handleMockRequest(state, { method: 'POST', path: '/_admin/client', query: {}, body: { name: 'ООО «Новичок»' }, authorization: 'Bearer t' }, nowMs())
    const run = await runFlow(flow, store)
    expect(run.received).toBe(1)
    expect(seen.at(-1)!.map(c => c.name)).toEqual(['ООО «Новичок»'])
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

