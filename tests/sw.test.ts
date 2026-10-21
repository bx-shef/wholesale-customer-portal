// Правила кэша сервис-воркера (public/sw.js): что можно отдать без сети, а что — никогда.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '../public/sw.js'), 'utf8')
const ctx: Record<string, unknown> = { self: { location: { origin: 'https://wsp.algena.by' }, addEventListener: () => {} }, URL }
runInNewContext(src, ctx)
const rule = ctx.cacheRule as (url: string, method: string) => string | null
const at = (p: string, m = 'GET') => rule(`https://wsp.algena.by${p}`, m)

describe('sw.js: cacheRule', () => {
  it('статика и картинки — сначала кэш', () => {
    for (const p of ['/_nuxt/app.js', '/images/abc.def', '/logo.png', '/favicon.svg']) expect(at(p)).toBe('static')
  })
  it('каталог и его страницы — сначала сеть, без сети — кэш', () => {
    for (const p of ['/api/catalog/list?q=клей', '/api/catalog/item/1', '/', '/product/x']) expect(at(p)).toBe('data')
  })
  it('корзина, заявки, профиль, вход, ИИ, MCP, коробка и любые записи — мимо кэша', () => {
    for (const p of ['/api/cart/quote', '/api/orders', '/api/profile', '/api/auth/me', '/api/ai/chat', '/mcp/client', '/b24/app', '/cart', '/orders', '/login', '/api/onec-test']) expect(at(p), p).toBeNull()
    expect(at('/api/catalog/list', 'POST')).toBeNull()
    expect(rule('https://other.example/_nuxt/app.js', 'GET')).toBeNull()
  })
})

describe('кэш каталога чистится при входе и выходе', () => {
  it('login.vue и AppHeader.vue зовут clearCatalogCache, имя кэша совпадает с sw.js', () => {
    const root = join(__dirname, '..')
    expect(readFileSync(join(root, 'app/pages/login.vue'), 'utf8')).toContain('await clearCatalogCache()')
    expect(readFileSync(join(root, 'app/components/AppHeader.vue'), 'utf8')).toContain('await clearCatalogCache()')
    const name = /CATALOG_CACHE = '([^']+)'/.exec(readFileSync(join(root, 'app/composables/usePwa.ts'), 'utf8'))![1]
    expect(src).toContain(`const DATA = '${name}'`)
  })
})
