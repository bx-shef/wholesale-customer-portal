/**
 * Один тик оповещений: план по эпизодам → отправка → новое состояние. Чистая функция с
 * внедрённой отправкой; задача `monitor:alerts` только загружает и сохраняет состояние.
 *
 * - Удачно отправленное помечается объявленным, временный сбой (429, 5xx, сеть) — нет: следующий
 *   тик повторит.
 * - Постоянный отказ (400/403: неверный chat_id, бота выгнали из чата) тоже помечается, иначе
 *   каждые 5 минут шли бы одни и те же безнадёжные запросы; причина — в логе.
 */
import { alertMessage, episodeKey, markAnnounced, markRecovered, planAlertDelivery, recoveryMessage, type Alert, type DeliveryState } from './alertDelivery'
import type { TelegramSendResult } from './telegramAlert'

export interface AlertTickResult { state: DeliveryState, sent: number, failed: number }

export async function runAlertTick(alerts: Alert[], previous: DeliveryState, deps: {
  send: (text: string) => Promise<TelegramSendResult>
  now: number
  statusUrl: string | null
  warn?: (msg: string) => void
}): Promise<AlertTickResult> {
  const plan = planAlertDelivery(alerts, previous, deps.now)
  let state = plan.state
  let sent = 0
  let failed = 0
  const settled = (r: TelegramSendResult) => {
    if (r.ok) sent++
    else {
      failed++
      deps.warn?.(`[monitor] telegram ${r.status}${r.retryable ? ', повторим' : ', не повторяем'}`)
    }
    return r.ok || !r.retryable
  }
  for (const a of plan.opened) {
    if (settled(await deps.send(alertMessage(a, deps.statusUrl)))) state = markAnnounced(state, episodeKey(a), deps.now)
  }
  for (const key of plan.recovered) {
    if (settled(await deps.send(recoveryMessage(key)))) state = markRecovered(state, key)
  }
  return { state, sent, failed }
}

/** Состояние из базы: битое или чужой формы — пустое, а не падение задачи. */
export function parseDeliveryState(raw: string | null | undefined): DeliveryState {
  try {
    const v = JSON.parse(raw ?? '') as Partial<DeliveryState>
    const announced = v.announcedAtMs && typeof v.announcedAtMs === 'object' ? Object.fromEntries(Object.entries(v.announcedAtMs).filter(([, n]) => typeof n === 'number')) as Record<string, number> : {}
    const awaiting = Array.isArray(v.awaitingRecovery) ? v.awaitingRecovery.filter((k): k is string => typeof k === 'string') : []
    return { announcedAtMs: announced, awaitingRecovery: awaiting }
  }
  catch {
    return { announcedAtMs: {}, awaitingRecovery: [] }
  }
}
