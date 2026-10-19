/**
 * Ручной запуск потока со страницы `/api/system`. 1С хрупкая: поток не запускается, пока идёт
 * предыдущий, и не чаще своего интервала — тяжёлые каталог и прайс реже, чем остатки и заявки.
 */
export const MANUAL_MIN_INTERVAL_MS: Record<string, number> = {
  clients: 5 * 60_000,
  catalog: 15 * 60_000,
  prices: 10 * 60_000,
  stock: 2 * 60_000,
  orders: 2 * 60_000,
  schedule: 10 * 60_000,
  trips: 5 * 60_000,
}

export type ManualRunVerdict = { ok: true } | { ok: false, reason: 'busy' | 'too-soon', retryInMs: number }

export function manualRunVerdict(flow: string, running: ReadonlySet<string>, lastStartedAt: number | undefined, now: number): ManualRunVerdict {
  if (running.has(flow)) return { ok: false, reason: 'busy', retryInMs: 0 }
  const interval = MANUAL_MIN_INTERVAL_MS[flow] ?? 15 * 60_000
  if (lastStartedAt !== undefined && now - lastStartedAt < interval) return { ok: false, reason: 'too-soon', retryInMs: interval - (now - lastStartedAt) }
  return { ok: true }
}
