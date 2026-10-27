import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canOrder, maxOrderQty, parseStockMode } from '../shared/cart'

describe('заказ сверх остатка (ORDER_STOCK_MODE, владелец 2026-10-27)', () => {
  it('по умолчанию и при кривом значении — stock', () => {
    expect(parseStockMode(undefined)).toBe('stock')
    expect(parseStockMode('чушь')).toBe('stock')
    expect(parseStockMode(' Over ')).toBe('over')
    expect(parseStockMode('any')).toBe('any')
  })
  it('в корзину: stock и over — только при наличии, any — всегда', () => {
    expect(canOrder(0, 'stock')).toBe(false)
    expect(canOrder(0, 'over')).toBe(false)
    expect(canOrder(0, 'any')).toBe(true)
    expect(canOrder(3, 'stock')).toBe(true)
  })
  it('предел: остаток вниз до упаковки; меньше минимума — 0; в over/any без предела', () => {
    expect(maxOrderQty(8, 1, 1, 'stock')).toBe(8)
    expect(maxOrderQty(19, 5, 5, 'stock')).toBe(15)
    expect(maxOrderQty(4, 5, 5, 'stock')).toBe(0)
    expect(maxOrderQty(0.75, 0.25, 0.25, 'stock')).toBe(0.75)
    expect(maxOrderQty(8, 1, 1, 'over')).toBe(Infinity)
  })
  it('страницы ограничивают «+» пределом', () => {
    for (const f of ['app/pages/index.vue', 'app/pages/product/[guid].vue', 'app/pages/cart.vue']) expect(readFileSync(f, 'utf8'), f).toMatch(/<QtyStepper[^>]*:max="maxOrderQty\(/)
    expect(readFileSync('app/components/QtyStepper.vue', 'utf8')).toContain(':disabled="atMax"')
  })
})
