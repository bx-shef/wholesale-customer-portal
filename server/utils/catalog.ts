/**
 * Индекс каталога в SQLite (docs/spec.md §4: каталог раз в час, остатки раз в 5 минут).
 * Ответ каталога до 1 с — поэтому список и поиск идут из своей базы, а не в 1С на каждый запрос.
 * Цены здесь не хранятся: они зависят от клиента (server/utils/prices.ts).
 *
 * GUID 1С храним в нижнем регистре: контракт допускает любой регистр, а ключи должны совпадать.
 */
import { compareValues, type PropFilters } from '../../shared/propFilter'
import type { DatabaseSync } from 'node:sqlite'
import type { ImageRefT, ItemT, SectionT, StockT } from '../../shared/onec/schemas'
import { imageUrl, refFromUrl } from './imageStore'

export interface CatalogItem {
  guid: string
  sku: string
  name: string
  sectionGuid: string
  brand: string
  unit: string
  packQty: number
  minQty: number
  /** Сумма остатков по складам. */
  available: number
  /** Первая картинка — для списка; все картинки — в карточке. */
  image: string | null
}

export interface CatalogItemDetails extends CatalogItem {
  description: string
  properties: Record<string, string>
  images: string[]
  analogs: CatalogItem[]
  stock: { warehouseGuid: string, warehouseName: string, available: number }[]
}

export const SORTS = ['name', 'sku', 'available', 'price', 'price_desc'] as const
export type CatalogSort = typeof SORTS[number]

export interface CatalogQuery {
  q?: string
  section?: string
  /** Выбранные подразделы раздела: товары любого из них (с вложенными). */
  sub?: string[]
  brand?: string[]
  /** Характеристики: название → значения (`shared/propFilter.ts`). */
  props?: PropFilters
  inStock?: boolean
  sort?: CatalogSort
  /** Вид цен соглашения клиента — для сортировки по цене (#86); нет — сортировка по названию. */
  priceType?: string | null
  offset?: number
  limit?: number
}

export const CATALOG_PAGE_MAX = 60
/** Аналогов в карточке: больше — это уже раздел, а не подсказка. Сначала те, что в наличии. */
export const ANALOGS_MAX = 12
/** Сколько GUID аналогов храним: 1С может отдать сколько угодно, а в `IN (…)` SQLite есть предел. */
const ANALOGS_STORED_MAX = 50
/** Слов в поиске: каждое — условие LIKE по всему каталогу. */
const SEARCH_WORDS_MAX = 5
/** Раздел с подразделами: больше — это уже весь каталог, и `IN (…)` упёрся бы в предел SQLite. */
const SECTION_TREE_MAX = 1000
/** Значений одной характеристики в фильтре: больше — это уже поиск, а не выбор. */
const FACET_VALUES_MAX = 100
const FACET_TTL_MS = 5 * 60_000

export interface Facet { name: string, values: Array<{ value: string, count: number }> }
const SEARCH_MAX = 100

const lower = (s: string) => s.toLowerCase()
/** Строка поиска: название и артикул в нижнем регистре, ё → е. */
export const searchText = (s: string) => lower(s).replace(/ё/g, 'е')

/**
 * Разделы, скрытые от клиентов (`CATALOG_HIDDEN_SECTIONS`, решение владельца 2026-10-27): по названию,
 * без учёта регистра, вместе с подразделами. Чистая функция — проверяется тестом.
 */
export function hiddenSectionGuids(sections: { guid: string, parentGuid: string | null, name: string }[], names: readonly string[]): Set<string> {
  const want = new Set(names.map(n => n.trim().toLowerCase()).filter(Boolean))
  const hidden = new Set<string>()
  if (!want.size) return hidden
  for (const s of sections) if (want.has(s.name.trim().toLowerCase())) hidden.add(s.guid.toLowerCase())
  // Потомки — проходами до неподвижной точки (дерево неглубокое, разделов сотни).
  for (let grew = true; grew;) {
    grew = false
    for (const s of sections) {
      if (s.parentGuid && hidden.has(s.parentGuid.toLowerCase()) && !hidden.has(s.guid.toLowerCase())) {
        hidden.add(s.guid.toLowerCase())
        grew = true
      }
    }
  }
  return hidden
}

/** Характеристики без скрытых (`CATALOG_HIDDEN_PROPERTIES`): по названию, без учёта регистра. */
export function visibleProperties(props: Record<string, string>, hidden: readonly string[]): Record<string, string> {
  const drop = new Set(hidden.map(h => h.trim().toLowerCase()).filter(Boolean))
  return drop.size ? Object.fromEntries(Object.entries(props).filter(([k]) => !drop.has(k.trim().toLowerCase()))) : props
}

export function createCatalogStore(db: DatabaseSync, opts: { hiddenSections?: () => readonly string[], hiddenProperties?: () => readonly string[], filterProperties?: () => readonly string[] } = {}) {
  const upsertSection = db.prepare(`INSERT INTO catalog_section (guid, parent_guid, name) VALUES (?, ?, ?)
    ON CONFLICT (guid) DO UPDATE SET parent_guid = excluded.parent_guid, name = excluded.name`)
  const upsertItem = db.prepare(`INSERT INTO catalog_item
      (guid, sku, name, section_guid, brand, unit, pack_qty, min_qty, description, properties, images, analogs, search, name_sort, changed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (guid) DO UPDATE SET sku = excluded.sku, name = excluded.name, section_guid = excluded.section_guid,
      brand = excluded.brand, unit = excluded.unit, pack_qty = excluded.pack_qty, min_qty = excluded.min_qty,
      description = excluded.description, properties = excluded.properties, images = excluded.images,
      analogs = excluded.analogs, search = excluded.search, name_sort = excluded.name_sort, changed_at = excluded.changed_at`)
  const deleteItem = db.prepare('DELETE FROM catalog_item WHERE guid = ?')
  const deleteItemStock = db.prepare('DELETE FROM stock WHERE item_guid = ?')
  const itemExists = db.prepare('SELECT 1 FROM catalog_item WHERE guid = ?')
  const upsertStock = db.prepare(`INSERT INTO stock (item_guid, warehouse_guid, warehouse_name, available, changed_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (item_guid, warehouse_guid) DO UPDATE SET warehouse_name = excluded.warehouse_name,
      available = excluded.available, changed_at = excluded.changed_at`)

  const AVAILABLE = '(SELECT COALESCE(SUM(available), 0) FROM stock s WHERE s.item_guid = i.guid)'
  const COLUMNS = `i.guid, i.sku, i.name, i.section_guid AS sectionGuid, i.brand, i.unit,
    i.pack_qty AS packQty, i.min_qty AS minQty, ${AVAILABLE} AS available, json_extract(i.images, '$[0]') AS image`

  /** Раздел включает подразделы: клиент выбирает «Крепёж», а товары лежат в «Крепёж / Болты». */
  function sectionWithChildren(guid: string): string[] {
    const rows = db.prepare(`WITH RECURSIVE tree(g) AS (SELECT ? UNION SELECT s.guid FROM catalog_section s JOIN tree ON s.parent_guid = tree.g)
      SELECT g FROM tree LIMIT ${SECTION_TREE_MAX}`).all(lower(guid)) as { g: string }[]
    return rows.map(r => r.g)
  }

  function transaction(fn: () => void) {
    db.exec('BEGIN IMMEDIATE')
    try {
      fn()
      db.exec('COMMIT')
    }
    catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }

  function allSections(): { guid: string, parentGuid: string | null, name: string }[] {
    return db.prepare('SELECT guid, parent_guid AS parentGuid, name FROM catalog_section ORDER BY name').all() as never
  }
  /** Названия характеристик фильтра в нижнем регистре, по порядку, без скрытых. */
  function filterNames(): Set<string> {
    const hidden = new Set((opts.hiddenProperties?.() ?? []).map(h => h.trim().toLowerCase()))
    return new Set((opts.filterProperties?.() ?? []).map(n => n.trim().toLowerCase()).filter(n => n && !hidden.has(n)))
  }

  function computeFacets(section?: string): Facet[] {
    const allowed = filterNames()
    if (!allowed.size) return []
    const where: string[] = []
    const params: string[] = []
    if (section) {
      const ids = sectionWithChildren(section)
      where.push(`i.section_guid IN (${ids.map(() => '?').join(',')})`)
      params.push(...ids)
    }
    const nh = notHidden('i.')
    if (nh.sql) {
      where.push(nh.sql.replace(/^AND /, ''))
      params.push(...nh.params)
    }
    const rows = db.prepare(`SELECT j.key AS name, j.value AS value, COUNT(*) AS n FROM catalog_item i, json_each(i.properties) j
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} GROUP BY j.key, j.value`).all(...params) as Array<{ name: string, value: unknown, n: number }>
    const byName = new Map<string, Array<{ value: string, count: number }>>()
    for (const r of rows) {
      if (!allowed.has(r.name.trim().toLowerCase()) || typeof r.value !== 'string' || !r.value.trim()) continue
      const list = byName.get(r.name) ?? []
      list.push({ value: r.value, count: Number(r.n) })
      byName.set(r.name, list)
    }
    const order = [...allowed]
    return [...byName].filter(([, v]) => v.length > 1)
      .sort(([a], [b]) => order.indexOf(a.trim().toLowerCase()) - order.indexOf(b.trim().toLowerCase()))
      .map(([name, values]) => ({ name, values: values.sort((a, b) => compareValues(a.value, b.value)).slice(0, FACET_VALUES_MAX) }))
  }

  const facetCache = new Map<string, { at: number, facets: Facet[] }>()

  function hiddenNow(): Set<string> {
    const names = opts.hiddenSections?.() ?? []
    return names.length ? hiddenSectionGuids(allSections(), names) : new Set()
  }
  /** Условие «не из скрытых разделов» для SQL; скрытых нет — пусто. */
  function notHidden(alias: string): { sql: string, params: string[] } {
    const ids = [...hiddenNow()]
    return ids.length ? { sql: `AND ${alias}section_guid NOT IN (${ids.map(() => '?').join(',')})`, params: ids } : { sql: '', params: [] }
  }

  return {
    /** Разделы приходят целиком на первой странице каталога, товары — постранично. */
    /**
     * Разделы и товары одной выборки. Удалённый в 1С товар уходит из витрины вместе с остатками.
     * Разделы, исчезнувшие из 1С, не удаляем: контракт не передаёт пометку удаления раздела, а
     * пустой раздел безвреден — фильтр по нему просто ничего не найдёт.
     */
    saveCatalog(sections: SectionT[], items: ItemT[]) {
      transaction(() => {
        for (const s of sections) upsertSection.run(lower(s.guid), s.parentGuid ? lower(s.parentGuid) : null, s.name)
        for (const i of items) {
          const guid = lower(i.guid)
          if (i.deleted) {
            // Помеченный на удаление в 1С из витрины уходит сразу, вместе с остатками.
            deleteItem.run(guid)
            deleteItemStock.run(guid)
            continue
          }
          upsertItem.run(guid, i.sku, i.name, lower(i.sectionGuid), i.brand, i.unit, i.packQty, i.minQty, i.description,
            JSON.stringify(i.properties), JSON.stringify(i.images.map(imageUrl)), JSON.stringify(i.analogs.slice(0, ANALOGS_STORED_MAX).map(lower)),
            searchText(`${i.name} ${i.sku}`), searchText(i.name), i.changedAt)
        }
      })
    },

    saveStock(rows: StockT[]) {
      transaction(() => {
        // Остаток товара, которого нет в витрине (удалён в 1С или ещё не пришёл), не храним: он бы осиротел.
        for (const r of rows) if (itemExists.get(lower(r.itemGuid))) upsertStock.run(lower(r.itemGuid), lower(r.warehouseGuid), r.warehouseName, r.available, r.changedAt)
      })
    },

    /**
     * Остатки снимком (OData, docs/onec-odata.md): чего нет в снимке момента `snapshotAt`, того на
     * складе нет — строку убираем, иначе в ЛК висел бы вчерашний остаток.
     */
    pruneStockBefore(snapshotAt: string): number {
      // Сравнение моментов, а не строк: `…Z` и `…+03:00` как строки сравнивались бы неверно.
      return Number(db.prepare('DELETE FROM stock WHERE julianday(changed_at) < julianday(?)').run(snapshotAt).changes)
    },

    stockRows(): number {
      return Number((db.prepare('SELECT count(*) AS n FROM stock').get() as { n: number }).n)
    },

    sections(): { guid: string, parentGuid: string | null, name: string }[] {
      const hidden = hiddenNow()
      return allSections().filter(s => !hidden.has(s.guid.toLowerCase()))
    },

    /** Картинки всех товаров каталога — для докачки файлов из 1С (§2.8). */
    /**
     * Картинки для докачки — по очереди важности (решение владельца 2026-10-27): сначала товары в
     * наличии, потом остальные, в самом конце — товары скрытых разделов.
     */
    imageRefs(): ImageRefT[] {
      const hidden = [...hiddenNow()]
      const hiddenRank = hidden.length ? `CASE WHEN i.section_guid IN (${hidden.map(() => '?').join(',')}) THEN 1 ELSE 0 END` : '0'
      const rows = db.prepare(`SELECT j.value AS url FROM catalog_item i, json_each(i.images) j
        ORDER BY ${hiddenRank}, CASE WHEN ${AVAILABLE} > 0 THEN 0 ELSE 1 END, i.name_sort`).all(...hidden) as { url: string }[]
      return rows.map(r => refFromUrl(r.url)).filter((r): r is ImageRefT => r !== null)
    },
    /** Разделы, где есть товар в наличии (сами, без родителей) — меню прячет пустые при «В наличии». */
    stockSections(): string[] {
      const hidden = hiddenNow()
      return (db.prepare(`SELECT DISTINCT i.section_guid AS guid FROM catalog_item i WHERE ${AVAILABLE} > 0`).all() as { guid: string }[]).map(r => r.guid).filter(g => !hidden.has(g))
    },
    /** Разделы, где есть хоть один товар — пустые меню не показывает. */
    itemSections(): string[] {
      const hidden = hiddenNow()
      return (db.prepare('SELECT DISTINCT section_guid AS guid FROM catalog_item').all() as { guid: string }[]).map(r => r.guid).filter(g => !hidden.has(g))
    },
    brands(): string[] {
      const { sql, params } = notHidden('')
      return (db.prepare(`SELECT DISTINCT brand FROM catalog_item WHERE brand <> '' ${sql} ORDER BY brand`).all(...params) as { brand: string }[]).map(r => r.brand)
    },

    sectionWithChildren,

    /**
     * Характеристики для фильтра в разделе (или во всём каталоге): только из списка
     * `CATALOG_FILTER_PROPERTIES`, не скрытые, и где выбрать есть из чего — два значения и больше.
     */
    facets(section?: string): Facet[] {
      // Подсчёт идёт по всем товарам раздела — держим 5 минут: остатки и каталог меняются реже.
      const key = section?.toLowerCase() ?? ''
      const hit = facetCache.get(key)
      if (hit && Date.now() - hit.at < FACET_TTL_MS) return hit.facets
      const facets = computeFacets(section)
      facetCache.set(key, { at: Date.now(), facets })
      return facets
    },

    search(query: CatalogQuery): { items: CatalogItem[], total: number } {
      const where: string[] = []
      const params: (string | number)[] = []
      const q = searchText((query.q ?? '').trim()).slice(0, SEARCH_MAX)
      // Каждое слово — отдельное условие: «болт 10» находит «Болт М10 оцинк.».
      for (const word of q.split(/\s+/).filter(Boolean).slice(0, SEARCH_WORDS_MAX)) {
        where.push('i.search LIKE ? ESCAPE \'\\\'')
        params.push(`%${word.replace(/[\\%_]/g, c => `\\${c}`)}%`)
      }
      if (query.section) {
        // Подразделы берём только внутри раздела: чужой GUID в адресе выборку не расширит.
        const inSection = new Set(sectionWithChildren(query.section))
        const subs = (query.sub ?? []).map(lower).filter(g => inSection.has(g))
        const ids = subs.length ? [...new Set(subs.flatMap(sectionWithChildren))] : [...inSection]
        where.push(`i.section_guid IN (${ids.map(() => '?').join(',')})`)
        params.push(...ids)
      }
      if (query.brand?.length) {
        where.push(`i.brand IN (${query.brand.map(() => '?').join(',')})`)
        params.push(...query.brand)
      }
      // Характеристики: только из списка фильтра и не скрытые — по адресу чужую выборку не построить.
      const allowed = filterNames()
      for (const [name, values] of Object.entries(query.props ?? {})) {
        if (!allowed.has(name.trim().toLowerCase()) || !values.length) continue
        where.push(`EXISTS (SELECT 1 FROM json_each(i.properties) j WHERE j.key = ? AND j.value IN (${values.map(() => '?').join(',')}))`)
        params.push(name, ...values)
      }
      if (query.inStock) where.push(`${AVAILABLE} > 0`)
      const nh = notHidden('i.')
      if (nh.sql) {
        where.push(nh.sql.replace(/^AND /, ''))
        params.push(...nh.params)
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      // По цене — по виду цен соглашения клиента; товары без цены — в конце. Вида цен нет — по названию.
      const byPrice = (query.sort === 'price' || query.sort === 'price_desc') && query.priceType
      const join = byPrice ? 'LEFT JOIN price_list p ON p.item_guid = i.guid AND p.price_type_guid = ?' : ''
      const sort = byPrice ? query.sort! : query.sort === 'price' || query.sort === 'price_desc' ? 'name' : query.sort ?? 'name'
      const order = {
        name: 'i.name_sort, i.guid',
        sku: 'i.sku, i.guid',
        available: 'available DESC, i.name_sort, i.guid',
        price: 'p.price IS NULL, p.price, i.name_sort, i.guid',
        price_desc: 'p.price IS NULL, p.price DESC, i.name_sort, i.guid',
      }[sort]
      const limit = Math.min(Math.max(query.limit ?? 30, 1), CATALOG_PAGE_MAX)
      const offset = Math.max(query.offset ?? 0, 0)
      const total = (db.prepare(`SELECT COUNT(*) AS n FROM catalog_item i ${clause}`).get(...params) as { n: number }).n
      const items = db.prepare(`SELECT ${COLUMNS} FROM catalog_item i ${join} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
        .all(...(byPrice ? [query.priceType!.toLowerCase()] : []), ...params, limit, offset) as unknown as CatalogItem[]
      return { items, total: Number(total) }
    },

    item(guid: string): CatalogItemDetails | null {
      const row = db.prepare(`SELECT ${COLUMNS}, i.description, i.properties, i.images, i.analogs FROM catalog_item i WHERE i.guid = ?`)
        .get(lower(guid)) as (CatalogItem & { description: string, properties: string, images: string, analogs: string }) | undefined
      if (!row || hiddenNow().has(row.sectionGuid.toLowerCase())) return null
      const analogGuids = JSON.parse(row.analogs) as string[]
      const analogs = analogGuids.length
        ? db.prepare(`SELECT ${COLUMNS} FROM catalog_item i WHERE i.guid IN (${analogGuids.map(() => '?').join(',')}) ORDER BY available DESC, i.name_sort LIMIT ?`)
          .all(...analogGuids, ANALOGS_MAX) as unknown as CatalogItem[]
        : []
      const stock = db.prepare('SELECT warehouse_guid AS warehouseGuid, warehouse_name AS warehouseName, available FROM stock WHERE item_guid = ? ORDER BY warehouse_name')
        .all(row.guid) as never
      return { ...row, properties: visibleProperties(JSON.parse(row.properties), opts.hiddenProperties?.() ?? []), images: JSON.parse(row.images), analogs, stock }
    },
  }
}

export type CatalogStore = ReturnType<typeof createCatalogStore>
