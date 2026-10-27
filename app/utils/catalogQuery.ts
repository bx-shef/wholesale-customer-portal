/** Состояние каталога в адресе: ссылкой можно поделиться, «назад» возвращает к тем же фильтрам. */
export interface CatalogFilters {
  q: string
  section: string
  /** Подразделы выбранного раздела (третий уровень) — кнопками над списком; пусто — весь раздел. */
  sub: string[]
  /** Бренды — несколько: товар любого из них. */
  brand: string[]
  inStock: boolean
  sort: 'name' | 'sku' | 'available' | 'price' | 'price_desc'
}

export const DEFAULT_FILTERS: CatalogFilters = { q: '', section: '', sub: [], brand: [], inStock: true, sort: 'name' }

const BRANDS_MAX = 20
const many = (v: unknown) => [...new Set((Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string' && x !== ''))].slice(0, BRANDS_MAX)
const one = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '')

export function filtersFromQuery(query: Record<string, unknown>): CatalogFilters {
  const sort = one(query.sort)
  return {
    q: one(query.q),
    section: one(query.section),
    sub: many(query.sub),
    brand: many(query.brand),
    // «Только в наличии» включено по умолчанию (решение владельца 2026-10-27): в адресе — только выключение.
    inStock: one(query.inStock) !== '0',
    sort: parseSort(sort),
  }
}

/** В адрес — только отличия от умолчаний, чтобы чистый каталог оставался голым `/`. */
export function filtersToQuery(f: CatalogFilters): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  if (f.q.trim()) out.q = f.q.trim()
  if (f.section) out.section = f.section
  if (f.section && f.sub.length) out.sub = f.sub
  if (f.brand.length) out.brand = f.brand
  if (!f.inStock) out.inStock = '0'
  if (f.sort !== 'name') out.sort = f.sort
  return out
}

/** Варианты сортировки каталога для выбора в фильтрах (#77). */
export const SORT_ITEMS: Array<{ label: string, value: CatalogFilters['sort'] }> = [
  { label: 'По названию', value: 'name' },
  { label: 'Сначала в наличии', value: 'available' },
  { label: 'По артикулу', value: 'sku' },
  { label: 'Сначала дешевле', value: 'price' },
  { label: 'Сначала дороже', value: 'price_desc' },
]

/** Значение из выбора сортировки — только известное, иначе по названию. */
export function parseSort(v: unknown): CatalogFilters['sort'] {
  return v === 'sku' || v === 'available' || v === 'price' || v === 'price_desc' ? v : 'name'
}
