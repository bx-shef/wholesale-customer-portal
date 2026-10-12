/** Деньги и количества для экранов: русская локаль, валюта из ответа 1С (BYN). */
export const formatMoney = (value: number, currency: string) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)

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
