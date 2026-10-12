/** Состояние каталога в адресе: ссылкой можно поделиться, «назад» возвращает к тем же фильтрам. */
export interface CatalogFilters {
  q: string
  section: string
  brand: string
  inStock: boolean
  sort: 'name' | 'sku' | 'available'
}

export const DEFAULT_FILTERS: CatalogFilters = { q: '', section: '', brand: '', inStock: false, sort: 'name' }

const one = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '')

export function filtersFromQuery(query: Record<string, unknown>): CatalogFilters {
  const sort = one(query.sort)
  return {
    q: one(query.q),
    section: one(query.section),
    brand: one(query.brand),
    inStock: one(query.inStock) === '1',
    sort: sort === 'sku' || sort === 'available' ? sort : 'name',
  }
}

/** В адрес — только отличия от умолчаний, чтобы чистый каталог оставался голым `/`. */
export function filtersToQuery(f: CatalogFilters): Record<string, string> {
  const out: Record<string, string> = {}
  if (f.q.trim()) out.q = f.q.trim()
  if (f.section) out.section = f.section
  if (f.brand) out.brand = f.brand
  if (f.inStock) out.inStock = '1'
  if (f.sort !== 'name') out.sort = f.sort
  return out
}
