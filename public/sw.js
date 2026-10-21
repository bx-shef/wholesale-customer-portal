// Сервис-воркер ЛК (docs/plan.md, этап 3: PWA и офлайн-кэш каталога; docs/DEPLOY.md — выкат и откат).
// Чистые части — `cacheRule`, `cacheable`, `dataCacheName`: их проверяет tests/sw.test.ts вместе с
// обработчиками на подделанных `caches` и `fetch`.
//
// Без сети клиент видит каталог и карточки из последнего просмотра — только СВОЕЙ компании: кэш
// данных у каждой компании свой (`lk-data-<компания>`), текущую компанию сообщает страница
// (`lk-company`), без неё данные идут только из сети. Корзина, заявки, профиль, вход, ИИ, MCP и
// коробка в кэш не попадают никогда. Ответ 401/403 или редирект (сессия кончилась) стирает все кэши
// данных; выход и вход стирают их со страницы, а выход — ещё и заголовком `Clear-Site-Data`.
// Граница: совсем без сети сохранённый каталог виден любому, кто откроет кабинет на этом
// устройстве, пока его не стёр выход, вход другого или ответ сервера об окончании сессии.

const STATIC = 'lk-static-v2'
const DATA_PREFIX = 'lk-data-'
const META = 'lk-meta-v1'
/** Записей статики не больше: бандлы с хешем копятся от выката к выкату. */
const STATIC_MAX = 300
/** Записей каталога компании не больше: каждый поиск и фильтр — своя запись. */
const DATA_MAX = 500
/** Сколько ждём сеть, прежде чем отдать сохранённое: на плохой связи fetch висит минутами. */
const NETWORK_TIMEOUT_MS = 4000

/** Как отдавать запрос: 'static' — сначала кэш, 'data' — сначала сеть, null — мимо кэша. */
function cacheRule(url, method) {
  if (method !== 'GET') return null
  const u = new URL(url)
  if (u.origin !== self.location.origin) return null
  const p = u.pathname
  // `/_nuxt/builds/` — манифест сборки без хеша: из кэша он прятал бы новый выкат.
  if (p.startsWith('/_nuxt/builds/')) return null
  if (p.startsWith('/_nuxt/') || p.startsWith('/images/')) return 'static'
  if (p.startsWith('/api/catalog/')) return 'data'
  if (p.startsWith('/api/') || p.startsWith('/mcp') || p.startsWith('/b24') || p.startsWith('/mock-1c')) return null
  // Страницы каталога — чтобы открыть их без сети; остальные страницы без сети не нужны.
  if (p === '/' || /^\/product\/[^/]+$/.test(p)) return 'data'
  return null
}

/** Класть ли ответ в кэш: только прямой (без редиректа) 200 своего сайта. */
function cacheable(res) {
  return res.status === 200 && res.type === 'basic' && !res.redirected
}

/** Кэш данных компании; без компании — нет кэша (данные только из сети). */
function dataCacheName(company) {
  return company && /^[\w-]{1,64}$/.test(company) ? DATA_PREFIX + company : null
}

let company = null
let companyLoaded = false
async function currentCompany() {
  if (!companyLoaded) {
    const hit = await (await caches.open(META)).match('/__company')
    company = hit ? (await hit.text()) || null : null
    companyLoaded = true
  }
  return company
}
async function setCompany(id) {
  company = dataCacheName(id) ? id : null
  companyLoaded = true
  await (await caches.open(META)).put('/__company', new Response(company ?? ''))
}
async function dropData() {
  for (const name of await caches.keys()) if (name.startsWith(DATA_PREFIX)) await caches.delete(name)
}

/** Положить и вытеснить самые старые записи сверх `max`. */
async function putBounded(cache, request, res, max) {
  await cache.put(request, res).catch(() => {})
  const keys = await cache.keys()
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k)
}

async function fromCacheFirst(request) {
  const cache = await caches.open(STATIC)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (cacheable(res)) await putBounded(cache, request, res.clone(), STATIC_MAX)
  return res
}

/** Ответ сети: сессия кончилась — стереть все каталоги; иначе 200 — в кэш, если компания та же. */
async function settle(request, res, name) {
  if (res.status === 401 || res.status === 403 || res.redirected) return dropData()
  // Компания сменилась, пока шёл запрос (выход, вход другого) — прежней в кэш не пишем.
  if (!cacheable(res) || dataCacheName(await currentCompany()) !== name) return
  await putBounded(await caches.open(name), request, res.clone(), DATA_MAX)
}

async function fromNetworkFirst(event) {
  const request = event.request
  const name = dataCacheName(await currentCompany())
  const net = fetch(request)
  if (!name) return net
  // Ответ сети разбираем всегда, даже если отдали сохранённое по таймауту: 401 или редирект на
  // вход должны стереть каталог, иначе он жил бы на устройстве, пока не кончится сессия.
  const done = net.then(res => settle(request, res, name)).catch(() => {})
  event.waitUntil(done)
  let timer
  try {
    const res = await Promise.race([net, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS) })])
    clearTimeout(timer)
    await done
    return res
  }
  catch {
    clearTimeout(timer)
    const hit = await (await caches.open(name)).match(request)
    if (hit) return hit
    return net
  }
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== STATIC && name !== META && !name.startsWith(DATA_PREFIX)) await caches.delete(name)
    await self.clients.claim()
  })())
})
self.addEventListener('fetch', (event) => {
  const rule = cacheRule(event.request.url, event.request.method)
  if (rule === 'static') event.respondWith(fromCacheFirst(event.request))
  else if (rule === 'data') event.respondWith(fromNetworkFirst(event))
})
self.addEventListener('message', (event) => {
  const m = event.data
  if (!m || typeof m !== 'object') return
  if (m.type === 'lk-company') event.waitUntil(setCompany(typeof m.id === 'string' ? m.id : null))
  if (m.type === 'lk-clear') event.waitUntil(setCompany(null).then(dropData))
})
