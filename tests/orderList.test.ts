import { describe, expect, it } from 'vitest'
import { orderTab, pageOf, parseOrderTab } from '../shared/orderList'
import { isUnavailableProblem, mergeCartLines } from '../shared/cart'

describe('вкладки и страницы «Моих заявок» (#153)', () => {
  it('выполненные — доставленные и отменённые, остальное в работе', () => {
    expect(orderTab('delivered')).toBe('done')
    expect(orderTab('cancelled')).toBe('done')
    for (const s of ['pending', 'sending', 'sent', 'new', 'confirmed', 'assembled', 'shipped']) expect(orderTab(s)).toBe('active')
    expect(parseOrderTab('done')).toBe('done')
    expect(parseOrderTab('x')).toBe('active')
  })
  it('страница: от 1, не дальше последней, смещение по 20', () => {
    expect(pageOf('3', 45)).toEqual({ page: 3, offset: 40 })
    expect(pageOf('9', 45)).toEqual({ page: 3, offset: 40 })
    expect(pageOf('0', 45)).toEqual({ page: 1, offset: 0 })
    expect(pageOf('abc', 0)).toEqual({ page: 1, offset: 0 })
    expect(pageOf('2.7', 45)).toEqual({ page: 2, offset: 20 })
  })
})

describe('«Повторить заявку»: слияние с корзиной (#153)', () => {
  it('количества одного товара складываются, новые — в конец', () => {
    const r = mergeCartLines([{ guid: 'a', qty: 2 }], [{ guid: 'a', qty: 0.1 }, { guid: 'b', qty: 3 }])
    expect(r.lines).toEqual([{ guid: 'a', qty: 2.1 }, { guid: 'b', qty: 3 }])
    expect(r.added).toBe(2)
  })
  it('не трогает исходную корзину и пропускает мусор', () => {
    const cur = [{ guid: 'a', qty: 1 }]
    const r = mergeCartLines(cur, [{ guid: '', qty: 1 }, { guid: 'c', qty: 0 }])
    expect(cur).toEqual([{ guid: 'a', qty: 1 }])
    expect(r).toEqual({ lines: [{ guid: 'a', qty: 1 }], added: 0 })
  })
  it('лимит строк корзины соблюдается', () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ guid: `g${i}`, qty: 1 }))
    const r = mergeCartLines(full, [{ guid: 'new', qty: 1 }, { guid: 'g0', qty: 1 }])
    expect(r.lines.length).toBe(200)
    expect(r.lines[0]!.qty).toBe(2)
    expect(r.added).toBe(1)
  })
  it('недоступные — снятые с продажи и без остатка', () => {
    expect(isUnavailableProblem('not_found')).toBe(true)
    expect(isUnavailableProblem('out_of_stock')).toBe(true)
    expect(isUnavailableProblem('over_stock')).toBe(false)
    expect(isUnavailableProblem(null)).toBe(false)
  })
})
