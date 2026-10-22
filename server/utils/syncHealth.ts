/**
 * Здоровье обмена с 1С — чистые правила для оповещений и страницы «Состояние системы».
 * Смотрим не на снимок, а на то, что обмен ДВИЖЕТСЯ: последний удачный запуск каждого потока
 * не старше своего срока, сбои не идут подряд, 1С не на паузе.
 */
import type { Alert } from './alertDelivery'

export interface FlowRunRow { flow: string, status: string, startedAt: string, finishedAt: string | null, received: number, error: string | null }

/** Потоки обмена: подпись и сколько можно жить без удачного запуска (несколько интервалов расписания). */
export const FLOWS: Record<string, { label: string, staleMs: number }> = {
  client_data: { label: 'данные клиентов ЛК', staleMs: 40 * 60_000 },
  catalog: { label: 'каталог', staleMs: 3 * 60 * 60_000 },
  prices: { label: 'прайс', staleMs: 60 * 60_000 },
  stock: { label: 'остатки', staleMs: 30 * 60_000 },
  orders: { label: 'статусы заказов', staleMs: 20 * 60_000 },
  schedule: { label: 'график доставки', staleMs: 3 * 60 * 60_000 },
  trips: { label: 'рейсы', staleMs: 40 * 60_000 },
}

/** Потоки, которые ждём от текущего транспорта 1С: без тех, которых у него нет (OData — docs/onec-odata.md). */
export function activeFlows(unsupported: readonly string[] = []): string[] {
  return Object.keys(FLOWS).filter(f => !unsupported.includes(f))
}

/** Сбоев подряд, после которых сообщаем: один сбой — обычная случайность, следующий запуск его поправит. */
export const FAILURES_TO_ALERT = 2

export interface FlowHealth {
  flow: string
  label: string
  state: 'ok' | 'failing' | 'stale' | 'never'
  lastRun: FlowRunRow | null
  lastOkAt: string | null
  failuresInRow: number
}

/** `runs` — последние запуски потока, новые первыми. */
export function flowHealth(flow: string, runs: FlowRunRow[], nowMs: number, sinceStartMs: number): FlowHealth {
  const def = FLOWS[flow] ?? { label: flow, staleMs: 60 * 60_000 }
  const finished = runs.filter(r => r.status !== 'running')
  let failuresInRow = 0
  for (const r of finished) {
    if (r.status !== 'failed') break
    failuresInRow++
  }
  const lastOk = finished.find(r => r.status === 'done') ?? null
  const lastOkAt = lastOk ? (lastOk.finishedAt ?? lastOk.startedAt) : null
  let state: FlowHealth['state'] = 'ok'
  if (failuresInRow >= FAILURES_TO_ALERT) state = 'failing'
  else if (lastOkAt && nowMs - Date.parse(lastOkAt) > def.staleMs) state = 'stale'
  // Ни одного удачного запуска: тревога, только если процесс живёт дольше срока — иначе ложная на выкате.
  else if (!lastOkAt) state = sinceStartMs > def.staleMs ? 'stale' : 'never'
  return { flow, label: def.label, state, lastRun: finished[0] ?? runs[0] ?? null, lastOkAt, failuresInRow }
}

/**
 * Класс ошибки без текста: в журнале лежит `${name}: ${message}`, а сообщение бывает с куском
 * ответа 1С (данные клиента). В Telegram — внешний сервис, отозвать нельзя — уходит только имя.
 */
export function errorClass(error: string | null | undefined): string {
  const name = /^([A-Za-z][\w]{0,40}):/.exec(error ?? '')?.[1]
  return name ?? 'ошибка'
}

export function healthAlerts(flows: FlowHealth[], onec: { pausedUntil: number }, nowMs: number): Alert[] {
  const alerts: Alert[] = []
  for (const f of flows) {
    if (f.state === 'failing') {
      alerts.push({ kind: 'sync-failed', subject: f.label, text: `обмен «${f.label}» падает ${f.failuresInRow} раз подряд (${errorClass(f.lastRun?.error)}). Подробности — на странице состояния.` })
    }
    else if (f.state === 'stale') {
      alerts.push({ kind: 'sync-stale', subject: f.label, text: f.lastOkAt ? `обмен «${f.label}» не проходил с ${f.lastOkAt}.` : `обмен «${f.label}» ни разу не прошёл.` })
    }
  }
  if (onec.pausedUntil > nowMs) {
    alerts.push({ kind: 'onec-paused', subject: '1С', text: `1С не отвечает: после серии сбоев обращения приостановлены до ${new Date(onec.pausedUntil).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Minsk', hour: '2-digit', minute: '2-digit' })} по Минску.` })
  }
  return alerts
}
