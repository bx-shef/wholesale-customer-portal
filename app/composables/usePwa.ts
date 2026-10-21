/**
 * PWA: регистрация сервис-воркера (`public/sw.js`) и очистка кэша каталога. Кэш хранит цены
 * договора компании, поэтому при входе и выходе он удаляется — на общем устройстве следующий
 * вошедший чужих цен не увидит.
 */
export const CATALOG_CACHE = 'lk-data-v1'

export function registerServiceWorker() {
  if (import.meta.server || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

export async function clearCatalogCache() {
  if (import.meta.server || typeof caches === 'undefined') return
  await caches.delete(CATALOG_CACHE).catch(() => false)
}

/** Есть ли сеть — для плашки «нет сети: каталог из сохранённого». */
export function useOnline() {
  const online = ref(true)
  onMounted(() => {
    online.value = navigator.onLine
    const set = () => { online.value = navigator.onLine }
    window.addEventListener('online', set)
    window.addEventListener('offline', set)
    onBeforeUnmount(() => {
      window.removeEventListener('online', set)
      window.removeEventListener('offline', set)
    })
  })
  return online
}
