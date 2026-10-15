// Пробное сообщение в Telegram: дошло ли — ответ «ok», токен на экран не выводится.
import { ALERT_APP_NAME } from '../../utils/alertDelivery'

export default defineEventHandler(async (event) => {
  guardOnecTest(event)
  const telegram = resolveTelegramConfig()
  if (!telegram) throw createError({ statusCode: 409, message: 'Telegram не настроен: TELEGRAM_ALERT_BOT_TOKEN и TELEGRAM_ALERT_CHAT_ID' })
  const r = await sendTelegramAlert(telegram, `🔔 ${ALERT_APP_NAME}: пробное сообщение — оповещения доходят.`, fetch)
  return { ok: r.ok, status: r.status }
})
