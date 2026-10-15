/**
 * Бережём 1С (docs/onec-contract.md §1.8): не больше одного запроса одновременно и пауза после
 * серии сбоев. Обёртка над `fetch`, которую получает клиент 1С; чистая — время внедряется.
 */
export const ONEC_FAILURES_BEFORE_PAUSE = 3
export const ONEC_PAUSE_MS = 10 * 60_000

export class OnecPausedError extends Error {
  constructor(readonly until: number) {
    super(`1C paused after failures until ${new Date(until).toISOString()}`)
    this.name = 'OnecPausedError'
  }
}

export function createOnecGuard(opts: { failures?: number, pauseMs?: number, now?: () => number } = {}) {
  const limit = opts.failures ?? ONEC_FAILURES_BEFORE_PAUSE
  const pauseMs = opts.pauseMs ?? ONEC_PAUSE_MS
  const now = opts.now ?? Date.now
  let queue: Promise<unknown> = Promise.resolve()
  let failures = 0
  let pausedUntil = 0

  const run = async (call: () => Promise<Response>): Promise<Response> => {
    if (now() < pausedUntil) throw new OnecPausedError(pausedUntil)
    try {
      const res = await call()
      // 4xx — ответ живой базы на наш запрос, это не перегрузка; считаем только 5xx.
      if (res.status >= 500) fail()
      else failures = 0
      return res
    }
    catch (e) {
      fail()
      throw e
    }
  }
  function fail() {
    failures++
    if (failures >= limit) {
      pausedUntil = now() + pauseMs
      failures = 0
    }
  }

  return {
    /** Обёрнутый fetch: запросы встают в очередь по одному. */
    wrap(fetchImpl: typeof fetch): typeof fetch {
      return (input, init) => {
        const result = queue.then(() => run(() => fetchImpl(input, init)))
        queue = result.catch(() => undefined)
        return result
      }
    },
    state: () => ({ failures, pausedUntil }),
    /** Снять паузу вручную — со страницы «Состояние системы», когда 1С уже подняли. */
    reset() {
      failures = 0
      pausedUntil = 0
    },
  }
}
