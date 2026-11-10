/**
 * НДС: прайс 1С (вид цен «Прайс») — цены без НДС, ставка приходит отдельно у товара.
 * Клиенту показываем цену с НДС; строку считаем так же, как 1С: сумма без НДС, НДС с суммы, итог.
 * Деньги — в целых копейках, чтобы 0.1 + 0.2 не тянуло двоичный хвост в итог.
 */

/** Копейки из рублей: округление до ближайшей, хвост 1.005 → 1.01 (через toFixed не надёжно). */
const cents = (v: number) => Math.round(Math.round(v * 1e6) / 1e4)

/** Рубли с копейками без float-дрейфа. */
export const round2 = (v: number) => cents(v) / 100

/** Цена с НДС за единицу. */
export function grossPrice(net: number, rate: number): number {
  return cents(net * (100 + rate) / 100) / 100
}

export interface LineAmounts { sum: number, vat: number, total: number }

/** Строка как в 1С: сумма без НДС = цена × количество, НДС = сумма × ставка, итог = сумма + НДС. */
export function lineAmounts(net: number, qty: number, rate: number): LineAmounts {
  const sum = cents(net * qty)
  const vat = Math.round(sum * rate / 100)
  return { sum: sum / 100, vat: vat / 100, total: (sum + vat) / 100 }
}

/** Сумма денег по строкам — в копейках. */
export const sumMoney = (values: number[]) => values.reduce((s, v) => s + cents(v), 0) / 100
