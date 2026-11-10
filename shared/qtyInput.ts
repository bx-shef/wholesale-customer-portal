/**
 * Количество, набранное с клавиатуры в поле `QtyStepper`. Только экран: сервер пересчитывает
 * количество сам по правилам shared/cart.ts, поэтому файл отдельный от них.
 */
import { normalizeQty } from './cart'

/**
 * Нецифры отбрасываем, запятая — десятичная; вверх до упаковки, не меньше минимума, не больше `max`
 * (тогда вниз до упаковки). Пусто или ноль — 0: товар уходит из корзины, как кнопкой «−».
 */
export function parseQtyInput(raw: string, packQty: number, minQty: number, max = Infinity): number {
  const clean = raw.replace(',', '.').replace(/[^\d.]/g, '')
  const dot = clean.indexOf('.')
  const num = Number(dot < 0 ? clean : clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, ''))
  if (!Number.isFinite(num) || num <= 0) return 0
  const want = normalizeQty(num, packQty, minQty)
  if (want <= max) return want
  if (!Number.isFinite(max) || max <= 0) return 0
  const pack = Math.max(Math.round((packQty > 0 ? packQty : 1) * 1000), 1)
  const top = (Math.floor(Math.round(max * 1000) / pack) * pack) / 1000
  return top >= normalizeQty(minQty, packQty, minQty) ? top : 0
}
