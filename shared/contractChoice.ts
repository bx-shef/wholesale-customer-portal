/**
 * Выбор соглашения клиентом (#46): какое соглашение считать для цен и заявки. Хранится в cookie —
 * это только подсказка: сервер принимает лишь соглашение из действующих у клиента сессии.
 */
export const CONTRACT_COOKIE = 'lk_contract'
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** GUID из cookie или null, если там мусор. */
export function parseContractCookie(v: string | undefined | null): string | null {
  const s = (v ?? '').trim().toLowerCase()
  return GUID_RE.test(s) ? s : null
}

/** Подпись соглашения для выбора: наименование, номер и дата, валюта. */
export function contractLabel(c: { name?: string, number: string, date: string, currency: string }): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(c.date) ? c.date.split('-').reverse().join('.') : c.date
  const head = (c.name ?? '').trim() || 'Соглашение'
  const num = c.number.trim() ? ` № ${c.number.trim()}` : ''
  return `${head}${num} от ${date}, ${c.currency}`
}
