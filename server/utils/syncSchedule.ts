/**
 * Частота автосинхронизации с 1С — окружением, а не кодом (решение владельца 2026-10-23):
 * тестовую 1С бережём, боевую можно чаще, а пересборка ради частоты не нужна. Расписание Nitro
 * будит задачи раз в минуту, задача сама решает, пора ли (`isDue`). Пауза — кнопкой на странице
 * «Состояние системы», хранится в базе (`app_state`) и переживает выкат; ручной запуск работает и на паузе.
 */
import type { DatabaseSync } from 'node:sqlite'

/** Потоки автосинхронизации: переменная окружения и частота по умолчанию, минут. */
export const AUTO_FLOWS = {
  catalog: { env: 'SYNC_CATALOG_EVERY_MIN', every: 60 },
  prices: { env: 'SYNC_PRICES_EVERY_MIN', every: 15 },
  stock: { env: 'SYNC_STOCK_EVERY_MIN', every: 5 },
  client_data: { env: 'SYNC_CLIENTS_EVERY_MIN', every: 10 },
  orders: { env: 'SYNC_ORDERS_EVERY_MIN', every: 2 },
  schedule: { env: 'SYNC_SCHEDULE_EVERY_MIN', every: 60 },
  trips: { env: 'SYNC_TRIPS_EVERY_MIN', every: 10 },
  // Картинки — своим потоком (решение владельца 2026-10-27): докачка 40+ тыс. файлов не ждёт суточного каталога.
  images: { env: 'SYNC_IMAGES_EVERY_MIN', every: 30 },
} as const
export type AutoFlow = keyof typeof AUTO_FLOWS

/** Не реже недели: больше — это уже «выключено», для этого есть 0. */
export const EVERY_MAX_MIN = 7 * 24 * 60

/** Минуты из окружения: пусто — по умолчанию, 0 — поток не ходит сам, кривое — по умолчанию. */
export function parseEvery(raw: string | undefined, fallback: number): number {
  const s = (raw ?? '').trim()
  if (s === '') return fallback
  const n = Number(s)
  return Number.isInteger(n) && n >= 0 && n <= EVERY_MAX_MIN ? n : fallback
}

export function everyFromEnv(get: (name: string) => string | undefined): Record<AutoFlow, number> {
  const out = {} as Record<AutoFlow, number>
  for (const [flow, def] of Object.entries(AUTO_FLOWS) as [AutoFlow, typeof AUTO_FLOWS[AutoFlow]][]) out[flow] = parseEvery(get(def.env), def.every)
  return out
}

/**
 * Пора ли запускать: 0 — никогда сам; не запускался в этом процессе — сразу. Допуск 30 секунд:
 * расписание будит раз в минуту, и «ровно через 15 минут» иначе съезжало бы на 16.
 */
export function isDue(lastStartMs: number | undefined, everyMin: number, nowMs: number): boolean {
  if (everyMin <= 0) return false
  return lastStartMs === undefined || nowMs - lastStartMs >= everyMin * 60_000 - 30_000
}

/** Срок «давно не было» для оповещений: не меньше трёх интервалов, иначе редкое расписание тревожит зря. */
export function staleMsFor(defaultMs: number, everyMin: number | undefined): number {
  if (everyMin === undefined) return defaultMs
  // 0 — поток только вручную: «давно не было» для него не тревога.
  return everyMin > 0 ? Math.max(defaultMs, everyMin * 3 * 60_000) : Infinity
}

const PAUSE_KEY = 'auto-sync-paused'

export function readAutoSyncPaused(db: DatabaseSync): { paused: boolean, since: string | null } {
  const row = db.prepare('SELECT value, updated_at AS at FROM app_state WHERE key = ?').get(PAUSE_KEY) as { value: string, at: string } | undefined
  return row?.value === '1' ? { paused: true, since: row.at } : { paused: false, since: null }
}

export function writeAutoSyncPaused(db: DatabaseSync, paused: boolean, at: string): void {
  db.prepare(`INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(PAUSE_KEY, paused ? '1' : '0', at)
}

/**
 * Пауза не останавливает заявки: досылка заявок в CRM от 1С не зависит, а остановленная молча
 * оставила бы клиента без ответа менеджера (ревью PR #94).
 */
export const PAUSE_EXEMPT: readonly AutoFlow[] = ['orders']

const lastAutoStart = new Map<AutoFlow, number>()

/** Последний запуск потока: память процесса, иначе журнал `sync_run` — выкат не будит все потоки разом. */
function lastStart(flow: AutoFlow, db: DatabaseSync): number | undefined {
  if (!lastAutoStart.has(flow)) {
    const row = db.prepare('SELECT max(started_at) AS at FROM sync_run WHERE flow = ?').get(flow) as { at: string | null } | undefined
    if (row?.at) lastAutoStart.set(flow, Date.parse(row.at))
  }
  return lastAutoStart.get(flow)
}

/** Запуск мимо расписания (прогрев при старте, кнопка): расписание не повторит его тут же. */
export function markAutoStart(flow: AutoFlow, now = Date.now()): void {
  lastAutoStart.set(flow, now)
}

/** Решение задачи расписания: `null` — запускать (и момент запомнен), иначе причина пропуска. */
export function autoSyncSkip(flow: AutoFlow, deps: { db: DatabaseSync, every: Record<AutoFlow, number>, now?: number }): string | null {
  const now = deps.now ?? Date.now()
  if (!PAUSE_EXEMPT.includes(flow) && readAutoSyncPaused(deps.db).paused) return 'skipped: auto sync paused'
  if (!isDue(lastStart(flow, deps.db), deps.every[flow], now)) return deps.every[flow] <= 0 ? 'skipped: auto sync off for this flow' : 'skipped: not due'
  lastAutoStart.set(flow, now)
  return null
}

/** Только для тестов: память процесса о последних запусках. */
export function resetAutoSyncMemory(): void {
  lastAutoStart.clear()
}
