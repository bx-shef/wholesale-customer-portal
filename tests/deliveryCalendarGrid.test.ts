import { describe, expect, it } from 'vitest'
import { calendarWeeks } from '../shared/delivery'

describe('сетка календаря доставок (2026-11-19)', () => {
  // 2026-11-19 — четверг; окно 14 дней — по 2026-12-02 (среда).
  const day = { date: '2026-11-20', cities: [{ city: 'Иваново', cutoffAt: '2026-11-19T20:59:00.000Z', open: true }] }
  const weeks = calendarWeeks('2026-11-19', 14, [day])
  it('недели с понедельника по воскресенье, окно накрыто целиком', () => {
    expect(weeks.length).toBe(3)
    expect(weeks[0][0].date).toBe('2026-11-16')
    expect(weeks[2][6].date).toBe('2026-12-06')
    expect(weeks.every(w => w.length === 7)).toBe(true)
  })
  it('прошедшие дни и дни вне окна помечены', () => {
    expect(weeks[0][2]).toMatchObject({ date: '2026-11-18', past: true, inRange: false })
    expect(weeks[0][3]).toMatchObject({ date: '2026-11-19', past: false, inRange: true })
    expect(weeks[2][2]).toMatchObject({ date: '2026-12-02', inRange: true })
    expect(weeks[2][3]).toMatchObject({ date: '2026-12-03', inRange: false, past: false })
  })
  it('день графика попадает в свою клетку', () => {
    expect(weeks[0][4].day).toBe(day)
    expect(weeks[0][5].day).toBeNull()
  })
})
