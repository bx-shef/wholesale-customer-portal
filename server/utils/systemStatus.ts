/**
 * «Состояние системы»: как идёт обмен с 1С и что лежит в базе ЛК. Одни и те же данные — для
 * страницы `/api/system` и для оповещений в Telegram (`server/tasks/monitor/alerts.ts`).
 * Данных клиентов здесь нет: только потоки, счётчики и ошибки обмена.
 */
import type { DatabaseSync } from 'node:sqlite'
import { FLOWS, flowHealth, healthAlerts, type FlowHealth, type FlowRunRow } from './syncHealth'

const STARTED_AT = Date.now()

export interface SystemStatus {
  now: string
  commit: string
  onec: { mode: 'mock' | 'real' | 'off', failuresInRow: number, pausedUntil: string | null }
  flows: FlowHealth[]
  counts: Record<string, number>
  orders: Record<string, number>
  recentRuns: FlowRunRow[]
  alerts: { kind: string, subject: string, text: string }[]
  telegram: boolean
}

export function readSystemStatus(db: DatabaseSync, deps: { guard: { failures: number, pausedUntil: number }, mode: SystemStatus['onec']['mode'], commit: string, telegram: boolean, now?: number }): SystemStatus {
  const now = deps.now ?? Date.now()
  const runsOf = db.prepare(`SELECT flow, status, started_at AS startedAt, finished_at AS finishedAt, received, error
    FROM sync_run WHERE flow = ? ORDER BY id DESC LIMIT 10`)
  const flows = Object.keys(FLOWS).map(f => flowHealth(f, runsOf.all(f) as unknown as FlowRunRow[], now, now - STARTED_AT))
  const one = (sql: string, ...params: string[]) => Number((db.prepare(sql).get(...params) as { n: number }).n)
  const counts = {
    'клиенты 1С': one('SELECT count(*) AS n FROM onec_client WHERE deleted = 0'),
    'клиенты с договором': one('SELECT count(*) AS n FROM onec_client WHERE deleted = 0 AND contract IS NOT NULL'),
    'товары': one('SELECT count(*) AS n FROM catalog_item'),
    'разделы': one('SELECT count(*) AS n FROM catalog_section'),
    'строки прайса': one('SELECT count(*) AS n FROM price_list'),
    'виды цен': one('SELECT count(DISTINCT price_type_guid) AS n FROM price_list'),
    'строки остатков': one('SELECT count(*) AS n FROM stock'),
    'диалоги ИИ за сутки': one('SELECT count(*) AS n FROM ai_dialog WHERE created_at > ?', new Date(now - 86_400_000).toISOString()),
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
    alerts: healthAlerts(flows, deps.guard, now),
    telegram: deps.telegram,
  }
}

/** Обвязка для маршрутов и задачи: окружение, база, защита 1С. */
export function currentSystemStatus(): SystemStatus {
  const env = readServerEnv()
  const real = !env.onecMock && !!env.onecUrl
  return readSystemStatus(useDb(), {
    guard: onecGuardState(),
    mode: env.onecMock ? 'mock' : real ? 'real' : 'off',
    commit: env.commitSha || 'dev',
    telegram: resolveTelegramConfig() !== null,
  })
}
