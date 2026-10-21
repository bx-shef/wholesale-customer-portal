/**
 * PWA (public/sw.js): регистрация сервис-воркера, текущая компания для кэша каталога, очистка.
 * Кэш каталога хранит цены договора, поэтому у каждой компании он свой, а при входе и выходе
 * стирается целиком — на общем устройстве следующий вошедший чужих цен не увидит.
 */
export const DATA_CACHE_PREFIX = 'lk-data-'

function post(message: object) {
  if (import.meta.server || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.controller?.postMessage(message)
  navigator.serviceWorker.ready.then(r => r.active?.postMessage(message)).catch(() => {})
}

export function registerServiceWorker() {
  if (import.meta.server || !('serviceWorker' in navigator)) return
  // В разработке воркер мешал бы правкам (бандлы без хешей из кэша) — снимаем, если был.
  if (import.meta.dev) {
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {})
    return
  }
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

/** Компания вошедшего — кэш каталога воркер ведёт только для неё. */
export function setCacheCompany(companyId: string | number) {
  post({ type: 'lk-company', id: String(companyId) })
}

/** Стереть все сохранённые каталоги и забыть компанию: вход, выход. */
export async function clearCatalogCache() {
  if (import.meta.server) return
  post({ type: 'lk-clear' })
  if (typeof caches === 'undefined') return
  const names = await caches.keys().catch(() => [] as string[])
  await Promise.all(names.filter(n => n.startsWith(DATA_CACHE_PREFIX)).map(n => caches.delete(n).catch(() => false)))
}

/** Есть ли сеть — для плашки «Нет сети». */
export function useOnline() {
  const online = ref(true)
  const set = () => { online.value = navigator.onLine }
  onMounted(() => {
    set()
    window.addEventListener('online', set)
    window.addEventListener('offline', set)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('online', set)
    window.removeEventListener('offline', set)
  })
  return online
}
