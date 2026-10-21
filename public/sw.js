// Сервис-воркер ЛК (docs/plan.md, этап 3: PWA и офлайн-кэш каталога).
// Правило кэша — чистая `cacheRule`: её же проверяет tests/sw.test.ts.
// Без сети клиент видит каталог и карточки из последнего просмотра; корзина, заявки, профиль и
// вход в кэш не попадают никогда. Кэш каталога — цены договора одной компании: страница удаляет
// его при входе и выходе (`clearCatalogCache`, app/composables/usePwa.ts), чтобы на общем
// устройстве не показать чужие цены.

const STATIC = 'lk-static-v1'
const DATA = 'lk-data-v1'

/** Как отдавать запрос: 'static' — сначала кэш, 'data' — сначала сеть, null — мимо кэша. */
function cacheRule(url, method) {
  if (method !== 'GET') return null
  const u = new URL(url)
  if (u.origin !== self.location.origin) return null
  const p = u.pathname
  if (p.startsWith('/_nuxt/') || p.startsWith('/images/') || p === '/logo.png' || p === '/favicon.svg') return 'static'
  if (p.startsWith('/api/catalog/')) return 'data'
  if (p.startsWith('/api/') || p.startsWith('/mcp') || p.startsWith('/b24') || p.startsWith('/mock-1c')) return null
  // Страницы каталога — чтобы открыть их без сети; остальные страницы без сети не нужны.
  if (p === '/' || p.startsWith('/product/')) return 'data'
  return null
}

async function fromCacheFirst(request) {
  const cache = await caches.open(STATIC)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok) cache.put(request, res.clone())
  return res
}

async function fromNetworkFirst(request) {
  const cache = await caches.open(DATA)
  try {
    const res = await fetch(request)
    if (res.ok) cache.put(request, res.clone())
    return res
  }
  catch (e) {
    const hit = await cache.match(request)
    if (hit) return hit
    throw e
  }
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== STATIC && name !== DATA) await caches.delete(name)
    await self.clients.claim()
  })())
})
self.addEventListener('fetch', (event) => {
  const rule = cacheRule(event.request.url, event.request.method)
  if (rule === 'static') event.respondWith(fromCacheFirst(event.request))
  else if (rule === 'data') event.respondWith(fromNetworkFirst(event.request))
})
