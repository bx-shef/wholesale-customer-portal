/**
 * Экран загрузки не мигает (#78): начавшись, держится не меньше `minMs`. Чистое правило — под
 * тестом; реактивная обёртка — `useMinLoading` в `app/composables`.
 */
export const MIN_LOADING_MS = 3000

/** Сколько ещё держать экран после того, как данные пришли; 0 — можно убирать. */
export function holdRemaining(startedAt: number | null, now: number, minMs = MIN_LOADING_MS): number {
  if (startedAt === null) return 0
  return Math.max(0, startedAt + minMs - now)
}

/**
 * Удержание экрана загрузки: `set(true)` — загрузка пошла, `set(false)` — данные пришли; `onChange`
 * получает, показывать ли экран. Время и таймер внедряются — поведение проверяется в тесте.
 */
export function createMinHold(opts: {
  onChange: (shown: boolean) => void
  minMs?: number
  now?: () => number
  schedule?: (fn: () => void, ms: number) => unknown
  cancel?: (handle: unknown) => void
}) {
  const now = opts.now ?? Date.now
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const cancel = opts.cancel ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>))
  let startedAt: number | null = null
  let handle: unknown
  const done = () => {
    handle = undefined
    startedAt = null
    opts.onChange(false)
  }
  return {
    set(loading: boolean) {
      if (handle !== undefined) cancel(handle)
      handle = undefined
      if (loading) {
        startedAt ??= now()
        opts.onChange(true)
        return
      }
      const left = holdRemaining(startedAt, now(), opts.minMs ?? MIN_LOADING_MS)
      if (left > 0) handle = schedule(done, left)
      else done()
    },
    stop() {
      if (handle !== undefined) cancel(handle)
      handle = undefined
    },
  }
}
