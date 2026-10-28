import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { orderStatus } from '../app/utils/format'

describe('статус заявки клиенту (стенд 2026-10-28: показывалось «new»)', () => {
  it('у каждого статуса ЛК — русская подпись', () => {
    for (const s of ['pending', 'sent', 'new', 'confirmed', 'assembled', 'shipped', 'delivered', 'cancelled']) {
      expect(orderStatus(s).label, s).toMatch(/^[А-ЯЁ]/)
    }
    expect(orderStatus('new').label).toBe('Принята')
  })
  it('«new» на шкале — шаг «Принята»', () => {
    expect(readFileSync('app/pages/orders.vue', 'utf8')).toContain("status === 'new' ? 'sent' : status")
  })
})
