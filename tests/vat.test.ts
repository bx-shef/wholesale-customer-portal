import { describe, expect, it } from 'vitest'
import { grossPrice, lineAmounts, round2, sumMoney } from '../shared/vat'

describe('НДС', () => {
  it('цена с НДС округляется до копейки', () => {
    expect(grossPrice(10, 20)).toBe(12)
    expect(grossPrice(1.23, 20)).toBe(1.48) // 1.476
    expect(grossPrice(0.1, 0)).toBe(0.1)
    expect(grossPrice(8.33, 20)).toBe(10) // 9.996
  })

  it('строка как в 1С: НДС с суммы, а не с цены', () => {
    // С цены: 1.48 × 3 = 4.44; 1С считает сумму 3.69 и НДС 0.74 — итог 4.43.
    expect(lineAmounts(1.23, 3, 20)).toEqual({ sum: 3.69, vat: 0.74, total: 4.43 })
    expect(lineAmounts(0.1, 3, 20)).toEqual({ sum: 0.3, vat: 0.06, total: 0.36 })
    expect(lineAmounts(5, 2, 0)).toEqual({ sum: 10, vat: 0, total: 10 })
    expect(lineAmounts(2.5, 1.5, 10)).toEqual({ sum: 3.75, vat: 0.38, total: 4.13 })
  })

  it('деньги без двоичного хвоста', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(sumMoney([0.1, 0.2])).toBe(0.3)
  })
})
