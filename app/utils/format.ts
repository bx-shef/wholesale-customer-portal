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
