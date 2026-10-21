// Сервис-воркер (public/sw.js): правила кэша и обработчики на подделанных `caches` и `fetch`.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const src = readFileSync(join(root, 'public/sw.js'), 'utf8')
const ORIGIN = 'https://wsp.algena.by'

/** Хранилище Cache Storage в памяти: имя кэша → (URL → ответ). */
function fakeCaches() {
  const store = new Map<string, Map<string, Response>>()
  const open = async (name: string) => {
    if (!store.has(name)) store.set(name, new Map())
    const m = store.get(name)!
    const key = (r: Request | string) => (typeof r === 'string' ? r : r.url)
    return {
      match: async (r: Request | string) => m.get(key(r))?.clone(),
      put: async (r: Request | string, res: Response) => { m.set(key(r), res) },
      keys: async () => [...m.keys()].map(u => new Request(u)),
      delete: async (r: Request | string) => m.delete(key(r)),
    }
  }
  return { store, api: { open, keys: async () => [...store.keys()], delete: async (n: string) => store.delete(n) } }
}

function load(fetchImpl: (req: Request) => Promise<Response>) {
  const caches = fakeCaches()
  const handlers: Record<string, (e: unknown) => void> = {}
  const ctx: Record<string, unknown> = {
    self: { location: { origin: ORIGIN }, addEventListener: (t: string, h: (e: unknown) => void) => { handlers[t] = h }, skipWaiting: () => {}, clients: { claim: async () => {} } },
    caches: caches.api, fetch: fetchImpl, URL, Request, Response, setTimeout, clearTimeout, Promise,
  }
  runInNewContext(src, ctx)
  const pending: Promise<unknown>[] = []
  const fetchEvent = async (path: string, method = 'GET') => {
    let out: Promise<Response> | undefined
    handlers.fetch!({ request: new Request(ORIGIN + path, { method }), respondWith: (p: Promise<Response>) => { out = p }, waitUntil: (p: Promise<unknown>) => { pending.push(p) } })
    return out
  }
  const settled = () => Promise.all(pending)
  const message = async (data: unknown) => {
    let w: Promise<unknown> | undefined
    handlers.message!({ data, waitUntil: (p: Promise<unknown>) => { w = p } })
    await w
  }
  return { ctx, caches, handlers, fetchEvent, message, settled }
}

const ok = (body: string, init: ResponseInit = {}) => {
  const r = new Response(body, { status: 200, ...init })
  Object.defineProperty(r, 'type', { value: 'basic' })
  return r
}

describe('sw.js: cacheRule', () => {
  const { ctx } = load(async () => ok(''))
  const rule = ctx.cacheRule as (url: string, method: string) => string | null
  const at = (p: string, m = 'GET') => rule(ORIGIN + p, m)
  it('статика с хешем — сначала кэш; логотип и иконка — мимо (без хеша устарели бы навсегда)', () => {
    for (const p of ['/_nuxt/app.js', '/images/abc.def']) expect(at(p)).toBe('static')
    expect(at('/_nuxt/builds/latest.json')).toBeNull()
    for (const p of ['/logo.png', '/favicon.svg', '/sw.js']) expect(at(p)).toBeNull()
  })
  it('каталог и его страницы — сначала сеть', () => {
    for (const p of ['/api/catalog/list?q=клей', '/', '/product/x']) expect(at(p)).toBe('data')
    for (const p of ['/products', '/productX', '/product/x/y']) expect(at(p), p).toBeNull()
  })
  it('корзина, заявки, профиль, вход, ИИ, MCP, коробка и записи — мимо кэша', () => {
    for (const p of ['/api/cart/quote', '/api/orders', '/api/profile', '/api/auth/me', '/api/ai/chat', '/mcp/client', '/b24/app', '/cart', '/orders', '/login']) expect(at(p), p).toBeNull()
    expect(at('/api/catalog/list', 'POST')).toBeNull()
    expect(rule('https://other.example/_nuxt/app.js', 'GET')).toBeNull()
  })
})

describe('sw.js: каталог без сети — только своей компании', () => {
  it('без компании — только сеть, ничего не кэшируется', async () => {
    const sw = load(async () => ok('цены'))
    expect(await (await sw.fetchEvent('/api/catalog/list'))!.text()).toBe('цены')
    expect([...sw.caches.store.keys()].some(n => n.startsWith('lk-data-'))).toBe(false)
  })

  it('с компанией: сохраняет 200; сеть упала — отдаёт сохранённое; другой компании — нет', async () => {
    let online = true
    const sw = load(async () => (online ? ok('цены А') : Promise.reject(new TypeError('offline'))))
    await sw.message({ type: 'lk-company', id: '7' })
    await sw.fetchEvent('/api/catalog/list')
    online = false
    expect(await (await sw.fetchEvent('/api/catalog/list'))!.text()).toBe('цены А')
    await sw.message({ type: 'lk-company', id: '8' })
    await expect(sw.fetchEvent('/api/catalog/list')).rejects.toThrow('offline')
  })

  it('не 200, редирект и 401 не сохраняются; 401 и редирект стирают все каталоги', async () => {
    let next: () => Response = () => ok('цены')
    const sw = load(async () => next())
    await sw.message({ type: 'lk-company', id: '7' })
    await sw.fetchEvent('/api/catalog/list')
    expect(sw.caches.store.get('lk-data-7')!.size).toBe(1)
    next = () => new Response('err', { status: 500 })
    await sw.fetchEvent('/api/catalog/other')
    expect(sw.caches.store.get('lk-data-7')!.size).toBe(1)
    next = () => {
      const r = ok('вход')
      Object.defineProperty(r, 'redirected', { value: true })
      return r
    }
    await sw.fetchEvent('/')
    expect(sw.caches.store.has('lk-data-7')).toBe(false)
    await sw.fetchEvent('/api/catalog/list')
    next = () => new Response('', { status: 401 })
    await sw.fetchEvent('/api/catalog/list')
    expect([...sw.caches.store.keys()].some(n => n.startsWith('lk-data-'))).toBe(false)
  })

  it('lk-clear стирает каталоги и забывает компанию', async () => {
    const sw = load(async () => ok('цены'))
    await sw.message({ type: 'lk-company', id: '7' })
    await sw.fetchEvent('/api/catalog/list')
    await sw.message({ type: 'lk-clear' })
    expect(sw.caches.store.has('lk-data-7')).toBe(false)
    await sw.fetchEvent('/api/catalog/list')
    expect(sw.caches.store.has('lk-data-7')).toBe(false)
  })
})

describe('sw.js: гонки', () => {
  it('медленная сеть: отдали сохранённое, а пришедший потом редирект на вход всё равно стёр каталог', async () => {
    let mode: 'ok' | 'slow' = 'ok'
    let release!: (r: Response) => void
    const sw = load(async () => {
      if (mode === 'ok') return ok('цены')
      return new Promise<Response>((r) => { release = r })
    })
    await sw.message({ type: 'lk-company', id: '7' })
    await sw.fetchEvent('/api/catalog/list')
    await sw.settled()
    mode = 'slow'
    const timeoutSrc = /NETWORK_TIMEOUT_MS = (\d+)/.exec(src)![1]
    expect(Number(timeoutSrc)).toBeLessThanOrEqual(5000)
    sw.ctx.setTimeout = (fn: () => void) => { fn(); return 0 }
    const res = await sw.fetchEvent('/api/catalog/list')
    expect(await res!.text()).toBe('цены')
    const redirect = ok('вход')
    Object.defineProperty(redirect, 'redirected', { value: true })
    release(redirect)
    await sw.settled()
    expect(sw.caches.store.has('lk-data-7')).toBe(false)
  })

  it('ответ, пришедший после смены компании, в кэш не пишется', async () => {
    let release!: (r: Response) => void
    const sw = load(() => new Promise<Response>((r) => { release = r }))
    await sw.message({ type: 'lk-company', id: '7' })
    const res = sw.fetchEvent('/api/catalog/list')
    await new Promise(r => setTimeout(r, 0))
    await sw.message({ type: 'lk-clear' })
    release(ok('цены А'))
    await res
    await sw.settled()
    expect(sw.caches.store.get('lk-data-7')?.size ?? 0).toBe(0)
  })
})

describe('sw.js: статика и обновление', () => {
  it('попадание в кэш — без сети; не 200 не сохраняется', async () => {
    let calls = 0
    let status = 200
    const sw = load(async () => {
      calls++
      return status === 200 ? ok('js') : ok('', { status })
    })
    await sw.fetchEvent('/_nuxt/a.js')
    await sw.fetchEvent('/_nuxt/a.js')
    expect(calls).toBe(1)
    status = 404
    await sw.fetchEvent('/_nuxt/b.js')
    expect(sw.caches.store.get('lk-static-v2')!.size).toBe(1)
  })

  it('статики хранится не больше STATIC_MAX записей — старые выкаты вытесняются', async () => {
    const sw = load(async () => ok('js'))
    const max = Number(/STATIC_MAX = (\d+)/.exec(src)![1])
    for (let i = 0; i <= max + 2; i++) await sw.fetchEvent(`/_nuxt/${i}.js`)
    const kept = [...sw.caches.store.get('lk-static-v2')!.keys()]
    expect(kept).toHaveLength(max)
    expect(kept).not.toContain(`${ORIGIN}/_nuxt/0.js`)
  })

  it('activate удаляет только чужие кэши; каталоги компаний и метка остаются', async () => {
    const sw = load(async () => ok(''))
    for (const n of ['lk-static-v1', 'lk-static-v2', 'lk-data-7', 'lk-meta-v1']) await sw.caches.api.open(n)
    let w: Promise<unknown> | undefined
    sw.handlers.activate!({ waitUntil: (p: Promise<unknown>) => { w = p } })
    await w
    expect([...sw.caches.store.keys()].sort()).toEqual(['lk-data-7', 'lk-meta-v1', 'lk-static-v2'])
  })
})

describe('страница и сервер чистят каталог при входе и выходе', () => {
  it('login.vue, AppHeader.vue (в finally), выход шлёт Clear-Site-Data, префикс кэша совпадает', () => {
    expect(readFileSync(join(root, 'app/pages/login.vue'), 'utf8')).toContain('await clearCatalogCache()')
    const header = readFileSync(join(root, 'app/components/AppHeader.vue'), 'utf8')
    // Выход: сохранённое стирается до запроса; без сети на /login не уходим.
    expect(header.indexOf('await clearCatalogCache()')).toBeLessThan(header.indexOf("$fetch('/api/auth/logout'"))
    expect(header).toMatch(/catch \{[^}]*logoutError\.value = [^}]*return\s*\}/)
    expect(header).toContain('setCacheCompany(')
    expect(readFileSync(join(root, 'server/api/auth/logout.post.ts'), 'utf8')).toContain("'Clear-Site-Data', '\"cache\", \"storage\"'")
    const prefix = /DATA_CACHE_PREFIX = '([^']+)'/.exec(readFileSync(join(root, 'app/composables/usePwa.ts'), 'utf8'))![1]
    expect(src).toContain(`const DATA_PREFIX = '${prefix}'`)
  })
})
