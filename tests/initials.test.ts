import { describe, expect, it } from 'vitest'
import { initials } from '../app/utils/initials'

describe('initials', () => {
  it('две заглавные буквы без правовой формы', () => {
    expect(initials('Ковальчук Андрей Григорьевич ИП')).toBe('КА')
    expect(initials('ООО «Ромашка»')).toBe('Р')
    expect(initials('ПМК-3 г.Береза')).toBe('ПГ')
    expect(initials('')).toBe('?')
  })
})
