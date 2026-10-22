// Сортировка каталога в фильтрах (#77): варианты, разбор выбора, сохранение в адресе.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS, filtersToQuery, parseSort, SORT_ITEMS } from '../app/utils/catalogQuery'

describe('сортировка каталога', () => {
  it('три варианта, по названию — первым', () => {
    expect(SORT_ITEMS.map(s => s.value)).toEqual(['name', 'available', 'sku'])
  })

  it('выбор: известное значение — оно, прочее — по названию', () => {
    expect(parseSort('available')).toBe('available')
    expect(parseSort('sku')).toBe('sku')
    for (const v of ['price', '', null, 1]) expect(parseSort(v)).toBe('name')
  })

  it('сортировка попадает в адрес и в сохранённые фильтры', () => {
    expect(filtersToQuery({ ...DEFAULT_FILTERS, sort: 'available' }).sort).toBe('available')
    const page = readFileSync(join(__dirname, '../app/pages/index.vue'), 'utf8')
    expect(page).toContain('JSON.stringify(filtersToQuery(f))')
    expect(page).toContain('label="Сортировка"')
  })
})
