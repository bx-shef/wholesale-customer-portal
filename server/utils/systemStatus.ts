/**
 * «Состояние системы»: как идёт обмен с 1С и что лежит в базе ЛК. Одни и те же данные — для
 * страницы `/api/system` и для оповещений в Telegram (`server/tasks/monitor/alerts.ts`).
 * Данных клиентов здесь нет: только потоки, счётчики и ошибки обмена.
 */
import type { DatabaseSync } from 'node:sqlite'
import { activeFlows, flowHealth, FLOWS, healthAlerts, type FlowHealth, type FlowRunRow } from './syncHealth'
import { readAutoSyncPaused, staleMsFor } from './syncSchedule'

const STARTED_AT = Date.now()

export interface SystemStatus {
  now: string
  commit: string
  onec: { mode: 'mock' | 'real' | 'odata' | 'off', failuresInRow: number, pausedUntil: string | null }
  flows: FlowHealth[]
  counts: Record<string, number>
  orders: Record<string, number>
  recentRuns: FlowRunRow[]
  alerts: { kind: string, subject: string, text: string }[]
  /** Кривые значения окружения (`envWarnings`): только имена и что не так, без значений. */
  config: string[]
  telegram: boolean
  /** Названия потоков по-русски — один источник (`FLOWS`) для таблицы потоков и журнала запусков. */
  labels: Record<string, string>
  /** Автосинхронизация: на паузе ли (кнопкой) и частота по потокам, минут (0 — только вручную). */
  autoSync: { paused: boolean, since: string | null, every: Record<string, number> }
}

export function readSystemStatus(db: DatabaseSync, deps: { guard: { failures: number, pausedUntil: number }, mode: SystemStatus['onec']['mode'], commit: string, telegram: boolean, now?: number, unsupportedFlows?: readonly string[], every?: Record<string, number>, config?: string[] }): SystemStatus {
  const now = deps.now ?? Date.now()
  const runsOf = db.prepare(`SELECT flow, status, started_at AS startedAt, finished_at AS finishedAt, received, error
    FROM sync_run WHERE flow = ? ORDER BY id DESC LIMIT 10`)
  const every = deps.every ?? {}
  const auto = readAutoSyncPaused(db)
  const flows = activeFlows(deps.unsupportedFlows).map(f => flowHealth(f, runsOf.all(f) as unknown as FlowRunRow[], now, now - STARTED_AT, staleMsFor(FLOWS[f]?.staleMs ?? 60 * 60_000, every[f])))
  const one = (sql: string, ...params: string[]) => Number((db.prepare(sql).get(...params) as { n: number }).n)
  const counts = {
    'клиенты 1С': one('SELECT count(*) AS n FROM onec_client WHERE deleted = 0'),
    'клиенты с договором': one('SELECT count(*) AS n FROM onec_client WHERE deleted = 0 AND contract IS NOT NULL'),
    'товары': one('SELECT count(*) AS n FROM catalog_item'),
    'разделы': one('SELECT count(*) AS n FROM catalog_section'),
    'строки прайса': one('SELECT count(*) AS n FROM price_list'),
    'виды цен': one('SELECT count(DISTINCT price_type_guid) AS n FROM price_list'),
    'строки остатков': one('SELECT count(*) AS n FROM stock'),
    'регионы в графике': one('SELECT count(*) AS n FROM delivery_schedule'),
    'рейсы на неделю': one('SELECT count(*) AS n FROM trip WHERE deleted = 0 AND planned_start >= ? AND planned_start < ?', new Date(now - 86_400_000).toISOString(), new Date(now + 7 * 86_400_000).toISOString()),
  }
  const orders: Record<string, number> = {}
  for (const r of db.prepare('SELECT status, count(*) AS n FROM order_request GROUP BY status').all() as { status: string, n: number }[]) orders[r.status] = Number(r.n)
  const recentRuns = db.prepare(`SELECT flow, status, started_at AS startedAt, finished_at AS finishedAt, received, error
    FROM sync_run ORDER BY id DESC LIMIT 30`).all() as unknown as FlowRunRow[]
  return {
    now: new Date(now).toISOString(),
    commit: deps.commit,
    onec: { mode: deps.mode, failuresInRow: deps.guard.failures, pausedUntil: deps.guard.pausedUntil > now ? new Date(deps.guard.pausedUntil).toISOString() : null },
    flows,
    counts,
    orders,
    recentRuns,
    alerts: healthAlerts(flows, deps.guard, now, auto.paused),
    config: deps.config ?? [],
    telegram: deps.telegram,
    labels: Object.fromEntries(Object.entries(FLOWS).map(([k, v]) => [k, v.label])),
    autoSync: { ...auto, every },
  }
}

/** Обвязка для маршрутов и задачи: окружение, база, защита 1С. */
export function currentSystemStatus(): SystemStatus {
  const env = readServerEnv()
  const real = !env.onecMock && !!env.onecUrl
  return readSystemStatus(useDb(), {
    guard: onecGuardState(),
    mode: env.onecMock ? 'mock' : !real ? 'off' : env.onecMode === 'odata' ? 'odata' : 'real',
    unsupportedFlows: onecUnsupportedFlows(),
    commit: env.commitSha || 'dev',
    telegram: resolveTelegramConfig() !== null,
    every: env.syncEvery,
    config: envWarnings(process.env),
  })
}
