// Раз в 5 минут: здоровье обмена → Telegram по эпизодам (одно «⚠️» на поломку, одно «✅» на восстановление).
// Состояние эпизодов — в SQLite (`app_state`), чтобы выкат посреди аварии не дал повторного «⚠️» и не потерял «✅».
import { parseDeliveryState, runAlertTick } from '../../utils/alertTick'
import { sendTelegramAlert } from '../../utils/telegramAlert'

const KEY = 'alert-delivery'

export default defineTask({
  meta: { name: 'monitor:alerts', description: 'Здоровье обмена с 1С → Telegram' },
  async run() {
    const telegram = resolveTelegramConfig()
    if (!telegram) return { result: 'telegram off' }
    const db = useDb()
    const status = currentSystemStatus()
    const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(KEY) as { value: string } | undefined
    const publicUrl = readServerEnv().publicUrl
    const r = await runAlertTick(status.alerts, parseDeliveryState(row?.value), {
      send: text => sendTelegramAlert(telegram, text, fetch),
      now: Date.now(),
      statusUrl: publicUrl ? `${publicUrl}/api/system` : null,
      warn: msg => console.warn(msg),
    })
    db.prepare(`INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(KEY, JSON.stringify(r.state), new Date().toISOString())
    return { result: { alerts: status.alerts.length, sent: r.sent, failed: r.failed } }
  },
})
