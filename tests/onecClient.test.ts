import { describe, expect, it } from 'vitest'
import { collectPages, OnecClient, type OnecError, type OnecLogEntry } from '../server/services/onec'
import { createMockState } from '../server/mocks/onec/mock'
import { mockFetch } from '../server/mocks/onec/fetch'

const noSleep = async () => {}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

function clientWith(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof OnecClient>[0]> = {}) {
  return new OnecClient({ baseUrl: 'http://1c.local/hs', token: 'SECRET-TOKEN', fetch: fetchImpl, sleep: noSleep, ...extra })
}

describe('OnecClient', () => {
  it('повторяет 503 и проходит, когда 1С ожила', async () => {
    const state = createMockState('t')
    state.mode.failNext = 2
    const client = new OnecClient({ baseUrl: 'http://m/mock-1c', token: 't', fetch: mockFetch(state), sleep: noSleep, retries: 2 })
    expect((await client.clients()).items.length).toBe(5)
  })

  it('4xx не повторяет', async () => {
    let calls = 0
    const client = clientWith(async () => (calls++, json(404, { error: 'not_found', message: '' })))
    const e = await client.contract('x').catch((err: unknown) => err)
    expect(e).toMatchObject({ kind: 'http', status: 404, code: 'not_found' })
    expect(calls).toBe(1)
  })

  it('ответ не по контракту — ошибка contract без повторов и без значений в тексте', async () => {
    let calls = 0
    const client = clientWith(async () => (calls++, json(200, { items: [{ guid: 'не-guid', name: 'Секретный клиент' }], nextPage: null })))
    const e = await client.clients().catch((err: unknown) => err) as OnecError
    expect(e.kind).toBe('contract')
    expect(e.message).not.toContain('Секретный')
    expect(calls).toBe(1)
  })

  it('таймаут — kind timeout, повторяется', async () => {
    let calls = 0
    const hang: typeof fetch = (_url, init) => {
      calls++
      return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)))
    }
    const e = await clientWith(hang, { timeoutMs: 20, retries: 1 }).clients().catch((err: unknown) => err)
    expect(e).toMatchObject({ kind: 'timeout' })
    expect(calls).toBe(2)
  })

  it('токен уходит заголовком и не попадает в журнал', async () => {
    const log: OnecLogEntry[] = []
    let header = ''
    const client = clientWith(async (_url, init) => {
      header = new Headers(init!.headers).get('authorization') ?? ''
      return json(503, { error: 'unavailable', message: '' })
    }, { retries: 1, log: e => log.push(e) })
    await client.clients().catch(() => {})
    expect(header).toBe('Bearer SECRET-TOKEN')
    expect(log).toHaveLength(2)
    expect(JSON.stringify(log)).not.toContain('SECRET')
  })
})

describe('collectPages', () => {
  it('собирает страницы до nextPage: null', async () => {
    const pages = [{ items: [1, 2], nextPage: 2 }, { items: [3], nextPage: null }]
    expect(await collectPages(n => Promise.resolve(pages[n - 1]!))).toEqual([1, 2, 3])
  })
  it('не зацикливается на nextPage, который не растёт', async () => {
    await expect(collectPages(() => Promise.resolve({ items: [1], nextPage: 1 }))).rejects.toThrow(/does not advance/)
  })
})

describe('OnecClient — повторы и запрос', () => {
  it('429 повторяется, задержки растут 200 → 400 мс', async () => {
    const sleeps: number[] = []
    let calls = 0
    const client = new OnecClient({
      baseUrl: 'http://1c.local/hs', token: 't', retries: 2, sleep: async ms => { sleeps.push(ms) },
      fetch: async () => (calls++, json(429, { error: 'busy', message: '' })),
    })
    await client.clients().catch(() => {})
    expect(calls).toBe(3)
    expect(sleeps).toEqual([200, 400])
  })

  it('обрыв при чтении тела — network с повтором, а не contract', async () => {
    let calls = 0
    const broken = () => new Response(new ReadableStream({ start(c) { c.error(new TypeError('terminated')) } }), { status: 200 })
    const client = clientWith(async () => (calls++, broken()), { retries: 1 })
    const e = await client.clients().catch((err: unknown) => err)
    expect(e).toMatchObject({ kind: 'network' })
    expect(calls).toBe(2)
  })

  it('незаданные параметры не уходят в URL, GUID кодируется', async () => {
    const urls: string[] = []
    const client = clientWith(async (url) => {
      urls.push(String(url))
      return json(404, { error: 'not_found', message: '' })
    })
    await client.clients({ page: 2 }).catch(() => {})
    await client.contract('a/b?c').catch(() => {})
    expect(urls[0]).toBe('http://1c.local/hs/clients?page=2')
    expect(urls[1]).toBe('http://1c.local/hs/client/a%2Fb%3Fc/contract')
  })
})

describe('collectPages — предел', () => {
  it('бесконечный nextPage обрывается на maxPages', async () => {
    await expect(collectPages(n => Promise.resolve({ items: [n], nextPage: n + 1 }), 3)).rejects.toThrow(/more than 3 pages/)
  })
})

describe('mockFetch', () => {
  it('задержка «медленной 1С» прерывается таймаутом клиента, а не досиживается', async () => {
    const state = createMockState('t')
    state.mode.delayMs = 10_000
    const client = new OnecClient({ baseUrl: 'http://m/mock-1c', token: 't', fetch: mockFetch(state), timeoutMs: 30, retries: 0 })
    const started = Date.now()
    await expect(client.clients()).rejects.toMatchObject({ kind: 'timeout' })
    expect(Date.now() - started).toBeLessThan(2000)
  })
})
