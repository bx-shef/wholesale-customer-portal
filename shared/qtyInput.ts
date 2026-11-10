/**
 * Количество, набранное с клавиатуры в поле `QtyStepper`. Только экран: сервер пересчитывает
 * количество сам по правилам shared/cart.ts, поэтому файл отдельный от них.
 */
import { normalizeQty } from './cart'

/**
 * Нецифры отбрасываем, запятая — десятичная; вверх до упаковки, не меньше минимума, не больше `max`
 * (`max` — уже кратный упаковке, из `maxOrderQty`). Ноль — 0: товар уходит из корзины, как кнопкой «−»;
 * пустое поле — `null`: оставить прежнее количество.
 */
export function parseQtyInput(raw: string, packQty: number, minQty: number, max = Infinity): number | null {
  if (!/\d/.test(raw)) return null
  const clean = raw.replace(',', '.').replace(/[^\d.]/g, '')
  const dot = clean.indexOf('.')
  const num = Number(dot < 0 ? clean : clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, ''))
  if (!Number.isFinite(num) || num <= 0) return 0
  const want = normalizeQty(num, packQty, minQty)
  return want <= max ? want : max
}
