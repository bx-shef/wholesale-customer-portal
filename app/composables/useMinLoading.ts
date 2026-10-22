import { createMinHold, MIN_LOADING_MS } from '~~/shared/minLoading'

/**
 * `true`, пока идёт загрузка, и ещё до `minMs` после её начала (#78): быстрый ответ не даёт
 * экрану загрузки мигнуть. На сервере значение как у `loading` — разметка совпадает с браузером.
 * Правила удержания — `createMinHold` (shared/minLoading.ts), под тестом.
 */
export function useMinLoading(loading: () => boolean, minMs = MIN_LOADING_MS) {
  const shown = ref(loading())
  const hold = createMinHold({ minMs, onChange: (v) => { shown.value = v } })
  onMounted(() => {
    watch(loading, on => hold.set(on), { immediate: true })
  })
  onBeforeUnmount(() => hold.stop())
  return shown
}
