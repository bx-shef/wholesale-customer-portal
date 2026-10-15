/**
 * Оповещения оператору в Telegram — порт из client-bank-alfa-by (`server/utils/telegramAlert.ts`).
 *
 * Канал НАШ, для нас: «обмен с 1С встал», а не «этот клиент что-то сделал». Данных клиентов в
 * тексте нет — только названия потоков, числа и коды ошибок.
 *
 * Безопасность: токен бота стоит в адресе каждого вызова — его не пишем в журнал, не кладём в
 * текст ошибки и не возвращаем; наружу только статус. `parse_mode` не ставим: в простом тексте
 * нечему «сбежать», даже если в него когда-нибудь подставят чужую строку.
 */

export type AlertFetchFn = (
  url: string,
  init: { method: string, headers: Record<string, string>, body: string, signal?: AbortSignal },
) => Promise<{ status: number }>

export interface TelegramConfig {
  token: string
  /** Группа или канал: группы — отрицательные «-100…», личный чат — id пользователя, или @канал. */
  chatId: string
}

const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/
const CHAT_RE = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/

/** Канал из окружения или `null`, если выключен (обе переменные обязательны). */
export function resolveTelegramConfig(env: Record<string, string | undefined> = process.env): TelegramConfig | null {
  const token = (env.TELEGRAM_ALERT_BOT_TOKEN ?? '').trim()
  const chatId = (env.TELEGRAM_ALERT_CHAT_ID ?? '').trim()
  if (!TOKEN_RE.test(token) || !CHAT_RE.test(chatId)) return null
  return { token, chatId }
}

export interface TelegramSendResult { ok: boolean, status: number, retryable: boolean }

export const MAX_TELEGRAM_TEXT = 4096
/** Потолок одной отправки: без него вызов висел бы до 300 с, а сбой сети и авария часто совпадают. */
export const TELEGRAM_TIMEOUT_MS = 10_000

export async function sendTelegramAlert(config: TelegramConfig, text: string, fetchFn: AlertFetchFn, timeoutMs = TELEGRAM_TIMEOUT_MS): Promise<TelegramSendResult> {
  const body = JSON.stringify({ chat_id: config.chatId, text: text.slice(0, MAX_TELEGRAM_TEXT), disable_web_page_preview: true })
  let res: Awaited<ReturnType<AlertFetchFn>>
  try {
    res = await fetchFn(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    })
  }
  catch {
    // Ошибку не включаем: она может повторить адрес, а в адресе — токен.
    return { ok: false, status: 0, retryable: true }
  }
  return { ok: res.status === 200, status: res.status, retryable: res.status === 429 || res.status >= 500 }
}
