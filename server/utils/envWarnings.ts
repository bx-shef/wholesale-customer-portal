/**
 * Кривые значения окружения — предупреждением в лог при старте и на «Состоянии системы».
 * Docker читает `.env` построчно: комментарий в строке со значением, кавычки и перевод строки
 * Windows становятся частью значения, и сервис молча работает не так (2026-10-26: `ONEC_URL`
 * с комментарием дал «Invalid URL», а `ONEC_MODE` не применился). Значений в тексте нет — только
 * имя переменной: среди них пароли и токены.
 */
import { parseScheduleEnv } from '../../shared/delivery'

const FLAGS = ['ONEC_MOCK', 'ONEC_ODATA_ORDERS', 'ONEC_ODATA_TRIPS', 'ONEC_ODATA_IMAGES']
const URLS = ['ONEC_URL', 'PUBLIC_URL']
const KNOWN = /^(B24_|ONEC_|SESSION_|MCP_|TELEGRAM_|PUBLIC_URL$|SYNC_|CATALOG_|DELIVERY_|DATA_DIR$|TRUST_PROXY$)/

export function envWarnings(source: Record<string, string | undefined>): string[] {
  const out: string[] = []
  for (const [name, raw] of Object.entries(source)) {
    if (!KNOWN.test(name) || raw === undefined || raw === '') continue
    if (/\r/.test(raw)) out.push(`${name}: в значении перевод строки Windows (\\r) — сохраните .env с окончаниями строк LF`)
    if (/\s#/.test(raw)) out.push(`${name}: в значении « #» — похоже на комментарий в той же строке; комментарий пишите отдельной строкой`)
    if (/^["'].*["']$/.test(raw.trim())) out.push(`${name}: значение в кавычках — кавычки станут частью значения, уберите их`)
  }
  const v = (name: string) => (source[name] ?? '').trim()
  for (const f of FLAGS) {
    if (v(f) && !['true', 'false'].includes(v(f).toLowerCase())) out.push(`${f}: ожидается true или false`)
  }
  if (v('ONEC_MODE') && !['http', 'odata'].includes(v('ONEC_MODE').toLowerCase())) out.push('ONEC_MODE: ожидается http или odata — сейчас работает как http')
  for (const u of URLS) {
    if (!v(u)) continue
    try {
      new URL(v(u))
    }
    catch {
      out.push(`${u}: не адрес (ожидается https://…)`)
    }
  }
  if (v('DELIVERY_SCHEDULE')) for (const w of parseScheduleEnv(v('DELIVERY_SCHEDULE')).warnings) out.push(`DELIVERY_SCHEDULE: ${w}`)
  for (const [name, raw] of Object.entries(source)) {
    if (/^SYNC_\w+$/.test(name) && raw?.trim() && !/^\d+$/.test(raw.trim())) out.push(`${name}: ожидается целое число — сейчас взято значение по умолчанию`)
  }
  return out
}
