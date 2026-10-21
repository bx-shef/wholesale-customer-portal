/**
 * Прогоны стенда в фоне: долгий прогон (прайс на большой базе — больше минуты) не упирается в
 * таймаут прокси перед ЛК (504). POST запускает и сразу отдаёт номер, страница опрашивает результат.
 * Результаты — в памяти процесса, без доступа к 1С; живут `ttlMs` после завершения.
 */
import { randomUUID } from 'node:crypto'

export type StandJob<T> =
  | { status: 'running', startedAt: number }
  | { status: 'done', startedAt: number, finishedAt: number, result: T }
  | { status: 'failed', startedAt: number, finishedAt: number, error: string }

export function createStandJobs<T>(opts: { ttlMs?: number, max?: number, now?: () => number } = {}) {
  const ttl = opts.ttlMs ?? 30 * 60_000
  const max = opts.max ?? 50
  const now = opts.now ?? Date.now
  const jobs = new Map<string, StandJob<T>>()

  function prune() {
    const t = now()
    for (const [id, j] of jobs) if (j.status !== 'running' && t - j.finishedAt > ttl) jobs.delete(id)
    while (jobs.size > max) jobs.delete(jobs.keys().next().value!)
  }

  return {
    start(run: () => Promise<T>): string {
      prune()
      const id = randomUUID()
      const startedAt = now()
      jobs.set(id, { status: 'running', startedAt })
      run().then(
        result => jobs.set(id, { status: 'done', startedAt, finishedAt: now(), result }),
        (e: unknown) => jobs.set(id, { status: 'failed', startedAt, finishedAt: now(), error: e instanceof Error ? e.message : String(e) }),
      )
      return id
    },
    get(id: string): StandJob<T> | undefined {
      prune()
      return jobs.get(id)
    },
  }
}
