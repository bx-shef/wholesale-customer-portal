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
