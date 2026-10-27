import { describe, expect, it } from 'vitest'
import { ISO_UNIT, isoBox, isoPoint, isoRect } from '../app/utils/iso'

describe('изометрия сцены загрузки', () => {
  it('ось x — вправо-вниз, y — влево-вниз, z — вверх', () => {
    expect(isoPoint(0, 0)).toEqual([0, 0])
    const [ax, ay] = isoPoint(1, 0)
    expect(ax).toBeGreaterThan(0)
    expect(ay).toBe(ISO_UNIT / 2)
    expect(isoPoint(0, 1)[0]).toBe(-ax)
    expect(isoPoint(0, 0, 1)).toEqual([0, -ISO_UNIT])
  })
  it('верх коробки поднят на её высоту', () => {
    const b = isoBox(0, 0, 0, 1, 1, 2)
    expect(b.top.split(' ')[0]).toBe(isoPoint(0, 0, 2).join(','))
    expect(b.left.split(' ')).toHaveLength(4)
    expect(isoRect(0, 0, 1, 1).split(' ')[2]).toBe(isoPoint(1, 1).join(','))
  })
})
