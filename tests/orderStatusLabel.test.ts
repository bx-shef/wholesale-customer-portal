import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ORDER_STEPS, orderStatus, orderStepIndex } from '../app/utils/format'

describe('статус заявки клиенту (стенд 2026-10-28: показывалось «new»)', () => {
  it('у каждого статуса ЛК — русская подпись', () => {
    for (const s of ['pending', 'sent', 'new', 'confirmed', 'assembled', 'shipped', 'delivered', 'cancelled']) {
      expect(orderStatus(s).label, s).toMatch(/^[А-ЯЁ]/)
    }
    expect(orderStatus('new').label).toBe('Принята')
  })
  it('шкала: «Новая» первым шагом, «Принята» — следующим', () => {
    expect(ORDER_STEPS[0].label).toBe(orderStatus('sent').label)
    expect(orderStepIndex('sent')).toBe(0)
    expect(orderStepIndex('new')).toBe(1)
    expect(orderStepIndex('delivered')).toBe(ORDER_STEPS.length - 1)
    expect(orderStepIndex('cancelled')).toBe(-1)
    for (const s of ORDER_STEPS) expect(s.label).toBe(orderStatus(s.key).label)
  })
  it('сумма заявки — жирным, колонки состава с отступом', () => {
    const page = readFileSync('app/pages/orders.vue', 'utf8')
    expect(page).toContain('на сумму <b')
    expect(page).toContain('pl-4 text-right whitespace-nowrap')
  })
})
