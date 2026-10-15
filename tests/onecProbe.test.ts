import { describe, expect, it } from 'vitest'
import { createMockState } from '../server/mocks/onec/mock'
import { mockFetch } from '../server/mocks/onec/fetch'
import { basicCredentials, onecTestAllowed } from '../server/utils/onecTestAuth'
import { checkBaseUrl, runOnecProbe } from '../server/utils/onecProbe'

const mock = () => {
  const state = createMockState('t')
  return { baseUrl: 'http://mock.local/mock-1c', token: state.token, auth: { kind: 'bearer' as const, token: state.token }, fetch: mockFetch(state) }
}

describe('стенд 1С: проверки', () => {
  it('мок ЛК проходит всё, включая создание заказа и его повтор', async () => {
    const checks = await runOnecProbe({ ...mock(), allowOrder: true })
    expect(checks.filter(c => c.status !== 'ok')).toEqual([])
    expect(checks.map(c => c.id)).toContain('order')
  })

  it('все запросы стенда — с X-LK-Test: 1, заказ — с test: true и не виден в статусах', async () => {
    const m = mock()
    const seen: { test: string | null, body: string }[] = []
    const spy: typeof fetch = async (url, init) => {
      seen.push({ test: new Headers(init?.headers).get('x-lk-test'), body: String(init?.body ?? '') })
      return m.fetch(url, init)
    }
    const checks = await runOnecProbe({ ...m, fetch: spy, allowOrder: true })
    expect(checks.find(c => c.id === 'order')).toMatchObject({ status: 'ok', detail: expect.stringContaining('ТЕСТ-') })
    expect(seen.every(s => s.test === '1')).toBe(true)
    expect(seen.filter(s => s.body.includes('externalId')).every(s => JSON.parse(s.body).test === true)).toBe(true)
  })

  it('без галки заказ не создаётся — пропуск', async () => {
    const checks = await runOnecProbe({ ...mock(), allowOrder: false })
    expect(checks.find(c => c.id === 'order')).toMatchObject({ status: 'skip' })
  })

  it('сервис пускает без токена и не знает про лимит страницы — ошибки названы', async () => {
    const m = mock()
    const sloppy: typeof fetch = async (url, init) => {
      const u = new URL(String(url))
      u.searchParams.delete('pageSize')
      const headers = new Headers(init?.headers)
      headers.set('authorization', `Bearer ${m.token}`)
      return m.fetch(u, { ...init, headers })
    }
    const checks = await runOnecProbe({ ...m, fetch: sloppy, allowOrder: false })
    const byId = Object.fromEntries(checks.map(c => [c.id, c]))
    expect(byId['auth-none']).toMatchObject({ status: 'fail' })
    expect(byId['page-size']).toMatchObject({ status: 'fail', detail: expect.stringContaining('400') })
  })

  it('нет связи — каждая проверка с понятной причиной, без исключения наружу', async () => {
    const checks = await runOnecProbe({ baseUrl: 'https://1c.example', auth: { kind: 'basic', login: 'lk', password: 'p' }, allowOrder: true, fetch: async () => { throw new TypeError('fetch failed') } })
    expect(checks.find(c => c.id === 'clients')).toMatchObject({ status: 'fail', detail: expect.stringContaining('соединиться') })
  })
})

describe('авторизация в 1С', () => {
  it('Bearer — токен, Basic — логин:пароль в base64', async () => {
    const { onecAuthHeader } = await import('../server/services/onec')
    expect(onecAuthHeader({ kind: 'bearer', token: 'abc' })).toBe('Bearer abc')
    expect(onecAuthHeader({ kind: 'basic', login: 'ЛК', password: 'p:1' })).toBe(`Basic ${Buffer.from('ЛК:p:1').toString('base64')}`)
  })
})

describe('стенд 1С: доступ и адрес', () => {
  it('Basic: логин и пароль сверяются; логин не задан — любой; без пароля на сервере — закрыто', () => {
    const h = (s: string) => `Basic ${Buffer.from(s).toString('base64')}`
    expect(basicCredentials(h('any:p:ss'))).toEqual({ login: 'any', password: 'p:ss' })
    expect(onecTestAllowed(h('x:secret'), { login: '', password: 'secret' })).toBe(true)
    expect(onecTestAllowed(h('x:secret'), { login: 'onec', password: 'secret' })).toBe(false)
    expect(onecTestAllowed(h('onec:secret'), { login: 'onec', password: 'secret' })).toBe(true)
    expect(onecTestAllowed(h('onec:wrong'), { login: 'onec', password: 'secret' })).toBe(false)
    expect(onecTestAllowed(h('x:'), { login: '', password: '' })).toBe(false)
    expect(onecTestAllowed('Bearer secret', { login: '', password: 'secret' })).toBe(false)
  })

  it('адрес 1С — только https без логина, параметров и якоря', () => {
    expect(checkBaseUrl(' https://1c.algena.by/base/hs/lk/ ')).toBe('https://1c.algena.by/base/hs/lk')
    for (const bad of ['http://1c.algena.by/hs', 'https://u:p@1c.algena.by', 'https://1c.algena.by/hs?x=1', 'ftp://x', 'мусор']) expect(checkBaseUrl(bad)).toBeNull()
  })
})

describe('картинки из 1С (§2.8)', () => {
  it('докачивает только недостающие, проверяет формат и кладёт под hash ответа', async () => {
    const { fetchMissingImages, imageUrl, refFromUrl, sniffImage } = await import('../server/utils/imageStore')
    const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2]).toString('base64')
    const svg = Buffer.from('<svg onload="alert(1)"/>').toString('base64')
    const files = new Map<string, Buffer>([['have.h1', Buffer.from('x')]])
    const res = await fetchMissingImages(
      [{ id: 'have', hash: 'h1' }, { id: 'new', hash: 'h2' }, { id: 'new', hash: 'h2' }, { id: 'bad', hash: 'h3' }, { id: 'png', hash: 'h4' }],
      {
        fs: { exists: async n => files.has(n), write: async (n, b) => { files.set(n, b) } },
        load: async id => id === 'bad'
          ? { id, hash: 'h3', contentType: 'image/jpeg' as const, data: svg }
          : id === 'png' ? { id, hash: 'h4', contentType: 'image/png' as const, data: jpeg } : { id, hash: 'h9', contentType: 'image/jpeg' as const, data: jpeg },
      },
    )
    expect(res.saved).toBe(1)
    expect(files.has('new.h9')).toBe(true)
    expect(res.failed).toEqual([{ id: 'bad', reason: 'не JPEG, PNG или WebP' }, { id: 'png', reason: 'contentType image/png, а файл — image/jpeg' }])
    expect(refFromUrl(imageUrl({ id: 'a-1', hash: 'f0' }))).toEqual({ id: 'a-1', hash: 'f0' })
    expect(refFromUrl('https://algena.by/x.jpg')).toBeNull()
    expect(refFromUrl('/images/../etc.passwd')).toBeNull()
    expect(sniffImage(Buffer.from('RIFF0000WEBP'))).toBe('image/webp')
  })

  it('мок отдаёт картинку каталога в base64, и она проходит проверку ЛК', async () => {
    const { decodeImage } = await import('../server/utils/imageStore')
    const { OnecClient } = await import('../server/services/onec')
    const m = mock()
    const c = new OnecClient({ baseUrl: m.baseUrl, token: m.token, fetch: m.fetch, retries: 0 })
    const items = (await c.catalog({ pageSize: 500 })).items
    const ref = items.find(i => i.images.length)!.images[0]!
    expect(decodeImage(await c.image(ref.id), ref)).toMatchObject({ ok: true })
  })
})
