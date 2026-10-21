/**
 * Индекс каталога в SQLite (docs/spec.md §4: каталог раз в час, остатки раз в 5 минут).
 * Ответ каталога до 1 с — поэтому список и поиск идут из своей базы, а не в 1С на каждый запрос.
 * Цены здесь не хранятся: они зависят от клиента (server/utils/prices.ts).
 *
 * GUID 1С храним в нижнем регистре: контракт допускает любой регистр, а ключи должны совпадать.
 */
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

export const SORTS = ['name', 'sku', 'available'] as const
export type CatalogSort = typeof SORTS[number]

export interface CatalogQuery {
  q?: string
  section?: string
  brand?: string
  inStock?: boolean
  sort?: CatalogSort
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
const SEARCH_MAX = 100

const lower = (s: string) => s.toLowerCase()
/** Строка поиска: название и артикул в нижнем регистре, ё → е. */
export const searchText = (s: string) => lower(s).replace(/ё/g, 'е')

export function createCatalogStore(db: DatabaseSync) {
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
      return Number(db.prepare('DELETE FROM stock WHERE changed_at < ?').run(snapshotAt).changes)
    },

    sections(): { guid: string, parentGuid: string | null, name: string }[] {
      return db.prepare('SELECT guid, parent_guid AS parentGuid, name FROM catalog_section ORDER BY name').all() as never
    },

    /** Картинки всех товаров каталога — для докачки файлов из 1С (§2.8). */
    imageRefs(): ImageRefT[] {
      const rows = db.prepare(`SELECT j.value AS url FROM catalog_item i, json_each(i.images) j`).all() as { url: string }[]
      return rows.map(r => refFromUrl(r.url)).filter((r): r is ImageRefT => r !== null)
    },
    brands(): string[] {
      return (db.prepare('SELECT DISTINCT brand FROM catalog_item WHERE brand <> \'\' ORDER BY brand').all() as { brand: string }[]).map(r => r.brand)
    },

    sectionWithChildren,

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
        const ids = sectionWithChildren(query.section)
        where.push(`i.section_guid IN (${ids.map(() => '?').join(',')})`)
        params.push(...ids)
      }
      if (query.brand) {
        where.push('i.brand = ?')
        params.push(query.brand)
      }
      if (query.inStock) where.push(`${AVAILABLE} > 0`)
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const order = { name: 'i.name_sort, i.guid', sku: 'i.sku, i.guid', available: 'available DESC, i.name_sort, i.guid' }[query.sort ?? 'name']
      const limit = Math.min(Math.max(query.limit ?? 30, 1), CATALOG_PAGE_MAX)
      const offset = Math.max(query.offset ?? 0, 0)
      const total = (db.prepare(`SELECT COUNT(*) AS n FROM catalog_item i ${clause}`).get(...params) as { n: number }).n
      const items = db.prepare(`SELECT ${COLUMNS} FROM catalog_item i ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
        .all(...params, limit, offset) as unknown as CatalogItem[]
      return { items, total: Number(total) }
    },

    item(guid: string): CatalogItemDetails | null {
      const row = db.prepare(`SELECT ${COLUMNS}, i.description, i.properties, i.images, i.analogs FROM catalog_item i WHERE i.guid = ?`)
        .get(lower(guid)) as (CatalogItem & { description: string, properties: string, images: string, analogs: string }) | undefined
      if (!row) return null
      const analogGuids = JSON.parse(row.analogs) as string[]
      const analogs = analogGuids.length
        ? db.prepare(`SELECT ${COLUMNS} FROM catalog_item i WHERE i.guid IN (${analogGuids.map(() => '?').join(',')}) ORDER BY available DESC, i.name_sort LIMIT ?`)
          .all(...analogGuids, ANALOGS_MAX) as unknown as CatalogItem[]
        : []
      const stock = db.prepare('SELECT warehouse_guid AS warehouseGuid, warehouse_name AS warehouseName, available FROM stock WHERE item_guid = ? ORDER BY warehouse_name')
        .all(row.guid) as never
      return { ...row, properties: JSON.parse(row.properties), images: JSON.parse(row.images), analogs, stock }
    },
  }
}

export type CatalogStore = ReturnType<typeof createCatalogStore>
