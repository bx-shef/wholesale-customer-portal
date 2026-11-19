import { formatAmountWithPortal, type PortalCurrencyFormats } from '~~/shared/currencyFormat'

/** Справочник валют из данных «кто вошёл» в payload (`payload.data.me.currencies`). */
export function meCurrencies(payloadData: unknown): PortalCurrencyFormats | undefined {
  const me = (payloadData as { me?: { currencies?: unknown } } | null | undefined)?.me
  const c = me?.currencies
  return c && typeof c === 'object' && !Array.isArray(c) ? c as PortalCurrencyFormats : undefined
}

/**
 * Деньги для экранов — как валюту показывает сам Битрикс24 («524,16 руб.», 2026-11-19). Справочник
 * приходит в «кто вошёл» (`/api/auth/me`, ключ `me`); не прочитан — запасной вид `formatAmountWithPortal`.
 */
export const formatMoney = (value: number, currency: string) => {
  // В юнит-тестах вне Nuxt авто-импорта нет — тогда запасной вид.
  const data = (typeof tryUseNuxtApp === 'function' ? tryUseNuxtApp() : null)?.payload.data
  return formatAmountWithPortal(value, currency, meCurrencies(data))
}

export const formatQty = (value: number, unit: string) =>
  `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value)} ${unit}`

/** Остаток словами: точное число показываем, пока открыт вопрос «точно или градацией» (docs/spec.md §11). */
export function stockLabel(available: number, unit: string): { text: string, color: 'air-primary-success' | 'air-primary-warning' | 'air-primary-alert' } {
  if (available <= 0) return { text: 'Нет в наличии', color: 'air-primary-alert' }
  return { text: `В наличии: ${formatQty(available, unit)}`, color: 'air-primary-success' }
}

/** Статус заявки для клиента. `pending` — заявка сохранена, но CRM её ещё не приняла (повтор отправки). */
export function orderStatus(status: string): { label: string, color: 'air-primary' | 'air-primary-success' | 'air-primary-warning' | 'air-primary-alert' } {
  const map: Record<string, { label: string, color: 'air-primary' | 'air-primary-success' | 'air-primary-warning' | 'air-primary-alert' }> = {
    pending: { label: 'Не отправлена', color: 'air-primary-alert' },
    sent: { label: 'Новая', color: 'air-primary' },
    // Заказ создан в 1С и ждёт проведения менеджером (стенд 2026-10-28: показывалось «new»).
    new: { label: 'Принята', color: 'air-primary' },
    confirmed: { label: 'Подтверждена', color: 'air-primary' },
    assembled: { label: 'Собрана', color: 'air-primary' },
    shipped: { label: 'В пути', color: 'air-primary-warning' },
    delivered: { label: 'Доставлена', color: 'air-primary-success' },
    cancelled: { label: 'Отменена', color: 'air-primary-alert' },
  }
  return map[status] ?? { label: status, color: 'air-primary' }
}

/** «1 позиция», «2 позиции», «5 позиций». */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/** Шаги заявки на шкале: «Новая» — отправлена в CRM, «Принята» — заказ уже в 1С. */
export const ORDER_STEPS = [
  { key: 'sent', label: 'Новая' },
  { key: 'new', label: 'Принята' },
  { key: 'confirmed', label: 'Подтверждена' },
  { key: 'assembled', label: 'Собрана' },
  { key: 'shipped', label: 'В пути' },
  { key: 'delivered', label: 'Доставлена' },
] as const

/** Номер текущего шага заявки; -1 — заявка вне шкалы (не отправлена, отменена). */
export const orderStepIndex = (status: string) => ORDER_STEPS.findIndex(s => s.key === status)
