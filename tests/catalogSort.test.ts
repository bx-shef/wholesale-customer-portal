// Сортировка каталога в фильтрах (#77): варианты, разбор выбора, сохранение в адресе.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS, filtersFromQuery, filtersToQuery, parseSort, SORT_ITEMS } from '../app/utils/catalogQuery'
import { parseCatalogQuery } from '../server/utils/catalogView'

describe('сортировка каталога', () => {
  it('пять вариантов, по названию — первым, цена — в обе стороны (#86)', () => {
    expect(SORT_ITEMS.map(s => s.value)).toEqual(['name', 'available', 'sku', 'price', 'price_desc'])
  })

  it('выбор: известное значение — оно, прочее — по названию', () => {
    expect(parseSort('available')).toBe('available')
    expect(parseSort('sku')).toBe('sku')
    expect(parseSort('price_desc')).toBe('price_desc')
    for (const v of ['random', '', null, 1]) expect(parseSort(v)).toBe('name')
  })

  it('сортировка попадает в адрес и в сохранённые фильтры', () => {
    expect(filtersToQuery({ ...DEFAULT_FILTERS, sort: 'available' }).sort).toBe('available')
    const page = readFileSync(join(__dirname, '../app/pages/index.vue'), 'utf8')
    expect(page).toContain('JSON.stringify(filtersToQuery(f))')
    expect(page).toContain('label="Сортировка"')
  })
  it('бренды: несколько через повтор параметра, туда и обратно', () => {
    const f = filtersFromQuery({ brand: ['ЭРА', 'Ceresit', 'ЭРА', ''] })
    expect(f.brand).toEqual(['ЭРА', 'Ceresit'])
    expect(filtersToQuery(f).brand).toEqual(['ЭРА', 'Ceresit'])
    expect(filtersFromQuery({ brand: 'ЭРА' }).brand).toEqual(['ЭРА'])
    expect(parseCatalogQuery({ brand: ['ЭРА', 'Ceresit'] }).brand).toEqual(['ЭРА', 'Ceresit'])
    expect(parseCatalogQuery({}).brand).toBeUndefined()
  })
  it('подразделы — только вместе с разделом', () => {
    const G = '00000000-0000-0000-0000-000000000001'
    expect(filtersToQuery({ ...DEFAULT_FILTERS, sub: [G] }).sub).toBeUndefined()
    expect(filtersToQuery({ ...DEFAULT_FILTERS, section: G, sub: [G] }).sub).toEqual([G])
    expect(parseCatalogQuery({ sub: [G, 'x'] }).sub).toEqual([G])
  })
})
