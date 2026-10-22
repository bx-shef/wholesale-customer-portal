import { holdRemaining, MIN_LOADING_MS } from '~~/shared/minLoading'

/**
 * `true`, пока идёт загрузка, и ещё до `minMs` после её начала (#78): быстрый ответ не даёт
 * экрану загрузки мигнуть. Только в браузере — на сервере значение как у `loading`.
 */
export function useMinLoading(loading: () => boolean, minMs = MIN_LOADING_MS) {
  const shown = ref(loading())
  let startedAt: number | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  onMounted(() => {
    if (loading()) startedAt = Date.now()
    watch(loading, (on) => {
      clearTimeout(timer)
      if (on) {
        startedAt ??= Date.now()
        shown.value = true
        return
      }
      const left = holdRemaining(startedAt, Date.now(), minMs)
      const done = () => { shown.value = false; startedAt = null }
      if (left > 0) timer = setTimeout(done, left)
      else done()
    }, { immediate: true })
  })
  onBeforeUnmount(() => clearTimeout(timer))
  return shown
}
