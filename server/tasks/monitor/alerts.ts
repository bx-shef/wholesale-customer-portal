// Раз в 5 минут: здоровье обмена → Telegram по эпизодам (одно «⚠️» на поломку, одно «✅» на восстановление).
import { alertMessage, emptyDeliveryState, episodeKey, markAnnounced, markRecovered, planAlertDelivery, recoveryMessage, type DeliveryState } from '../../utils/alertDelivery'
import { sendTelegramAlert, type AlertFetchFn } from '../../utils/telegramAlert'

let state: DeliveryState = emptyDeliveryState()

export default defineTask({
  meta: { name: 'monitor:alerts', description: 'Здоровье обмена с 1С → Telegram' },
  async run() {
    const telegram = resolveTelegramConfig()
    if (!telegram) return { result: 'telegram off' }
    const status = currentSystemStatus()
    const now = Date.now()
    const plan = planAlertDelivery(status.alerts, state, now)
    state = plan.state
    const statusUrl = readServerEnv().publicUrl ? `${readServerEnv().publicUrl}/api/system` : null
    const send = (text: string) => sendTelegramAlert(telegram, text, globalThis.fetch as unknown as AlertFetchFn)
    for (const a of plan.opened) {
      const r = await send(alertMessage(a, statusUrl))
      if (r.ok) state = markAnnounced(state, episodeKey(a), now)
      else console.warn(`[monitor] telegram ${r.status}`)
    }
    for (const key of plan.recovered) {
      const r = await send(recoveryMessage(key))
      if (r.ok) state = markRecovered(state, key)
      else console.warn(`[monitor] telegram ${r.status}`)
    }
    return { result: { alerts: status.alerts.length, opened: plan.opened.length, recovered: plan.recovered.length } }
  },
})
