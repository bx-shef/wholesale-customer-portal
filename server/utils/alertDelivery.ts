/**
 * Что и когда стучится в Telegram — порт доставки по эпизодам из client-bank-alfa-by
 * (`queueAlertDeliver.ts`). Проверка идёт раз в 5 минут, а поломка длится дольше: сообщать на
 * каждый замер — двенадцать одинаковых сообщений в час, и канал перестанут читать.
 *
 * - **Не повторяться:** объявленная поломка молчит, пока не пройдёт.
 * - **Не терять:** «объявлено» — только после успешной отправки (`markAnnounced`); 429 повторяется.
 * - **Не мерцать:** повтор той же поломки после восстановления — не чаще раза в час, и «✅» шлём
 *   только про то, о чём сообщали «⚠️».
 */
export interface Alert {
  /** Тип поломки: `sync-failed`, `sync-stale`, `onec-paused`. */
  kind: string
  /** О чём: поток обмена или `1С`. */
  subject: string
  /** Текст для человека, без данных клиентов. */
  text: string
}

export type EpisodeKey = string
export const episodeKey = (a: Alert): EpisodeKey => `${a.kind}:${a.subject}`

export const MIN_REANNOUNCE_MS = 60 * 60 * 1000

export interface DeliveryState {
  announcedAtMs: Record<EpisodeKey, number>
  /** Эпизоды, о поломке которых сообщили, а о восстановлении — ещё нет. */
  awaitingRecovery: EpisodeKey[]
}

export const emptyDeliveryState = (): DeliveryState => ({ announcedAtMs: {}, awaitingRecovery: [] })

export interface DeliveryPlan { opened: Alert[], recovered: EpisodeKey[], state: DeliveryState }

export function planAlertDelivery(alerts: Alert[], previous: DeliveryState, nowMs: number): DeliveryPlan {
  const awaiting = new Set(previous.awaitingRecovery)
  const now = new Map(alerts.map(a => [episodeKey(a), a]))
  const opened: Alert[] = []
  for (const [key, alert] of now) {
    if (awaiting.has(key)) continue
    const last = previous.announcedAtMs[key]
    if (last !== undefined && nowMs - last < MIN_REANNOUNCE_MS) continue
    opened.push(alert)
  }
  const recovered = [...awaiting].filter(key => !now.has(key))
  const announcedAtMs: Record<EpisodeKey, number> = {}
  for (const [key, at] of Object.entries(previous.announcedAtMs)) {
    if (now.has(key) || nowMs - at < MIN_REANNOUNCE_MS) announcedAtMs[key] = at
  }
  // Восстановившийся эпизод остаётся «ждущим», пока ✅ реально не ушло (`markRecovered`).
  return { opened, recovered, state: { announcedAtMs, awaitingRecovery: [...awaiting] } }
}

export function markAnnounced(state: DeliveryState, key: EpisodeKey, nowMs: number): DeliveryState {
  return {
    announcedAtMs: { ...state.announcedAtMs, [key]: nowMs },
    awaitingRecovery: state.awaitingRecovery.includes(key) ? state.awaitingRecovery : [...state.awaitingRecovery, key],
  }
}

export function markRecovered(state: DeliveryState, key: EpisodeKey): DeliveryState {
  return { announcedAtMs: state.announcedAtMs, awaitingRecovery: state.awaitingRecovery.filter(k => k !== key) }
}

export const ALERT_APP_NAME = 'ЛК опта (Алгена)'

const RECOVERY: Record<string, (s: string) => string> = {
  'sync-failed': s => `обмен «${s}» снова проходит.`,
  'sync-stale': s => `обмен «${s}» снова запускается.`,
  'onec-paused': () => '1С снова отвечает, пауза снята.',
}

export const alertMessage = (a: Alert, statusUrl?: string | null) => [`⚠️ ${ALERT_APP_NAME}: ${a.text}`, ...(statusUrl ? [`Состояние: ${statusUrl}`] : [])].join('\n')

export function recoveryMessage(key: EpisodeKey): string {
  const cut = key.indexOf(':')
  const make = RECOVERY[key.slice(0, cut)]
  const subject = key.slice(cut + 1)
  return `✅ ${ALERT_APP_NAME}: ${make ? make(subject) : `${subject} — восстановлено.`}`
}
