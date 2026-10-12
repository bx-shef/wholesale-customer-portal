/**
 * Каталог глазами клиента: индекс + цены его договора. Чистые функции с внедряемыми
 * зависимостями — проверяются без сервера (tests/catalogView.test.ts).
 *
 * Граница данных: GUID клиента в 1С берётся только по компании из сессии; из запроса — никогда.
 */
import type { PriceT } from '../../shared/onec/schemas'
import type { CatalogItem, CatalogItemDetails, CatalogQuery, CatalogStore } from './catalog'
import { SORTS } from './catalog'

export interface PricedItem extends CatalogItem {
  price: { value: number, currency: string, vatRate: number } | null
}

export type PriceSource = (clientGuid: string, items: string[]) => Promise<Map<string, PriceT>>

/** Сколько верим GUID компании из CRM: GUID меняется только при перепривязке к другому клиенту 1С. */
export const COMPANY_GUID_TTL_MS = 10 * 60_000

export function createCompanyGuidResolver(
  getCompany: (id: number) => Promise<{ onecGuid: string | null } | null>,
  now: () => number = Date.now,
) {
  const cache = new Map<number, { until: number, guid: string | null }>()
  return async (companyId: number): Promise<string | null> => {
    const hit = cache.get(companyId)
    if (hit && hit.until > now()) return hit.guid
    const company = await getCompany(companyId)
    const guid = company?.onecGuid ?? null
    cache.set(companyId, { until: now() + COMPANY_GUID_TTL_MS, guid })
    return guid
  }
}

/** Параметры списка из строки запроса: всё лишнее и кривое отбрасывается, а не падает. */
export function parseCatalogQuery(q: Record<string, unknown>): CatalogQuery {
  const str = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined)
  const int = (v: unknown) => {
    const n = Number(str(v))
    return Number.isInteger(n) && n >= 0 ? n : undefined
  }
  const sort = str(q.sort)
  const section = str(q.section)
  return {
    q: str(q.q)?.slice(0, 100),
    section: section && /^[0-9a-f-]{36}$/i.test(section) ? section : undefined,
    brand: str(q.brand)?.slice(0, 100) || undefined,
    inStock: str(q.inStock) === '1',
    sort: (SORTS as readonly string[]).includes(sort ?? '') ? sort as CatalogQuery['sort'] : undefined,
    offset: int(q.offset),
    limit: int(q.limit),
  }
}

const toPrice = (p: PriceT | undefined) => (p ? { value: p.price, currency: p.currency, vatRate: p.vatRate } : null)

/**
 * Цены не пришли (1С недоступна) — каталог всё равно показываем, но без цен и с флагом:
 * экран говорит «цены временно недоступны», а не рисует нули.
 */
async function withPrices<T extends CatalogItem>(items: T[], clientGuid: string | null, prices: PriceSource) {
  if (!clientGuid || items.length === 0) return { items: items.map(i => ({ ...i, price: null })), pricesAvailable: !!clientGuid }
  try {
    const map = await prices(clientGuid, items.map(i => i.guid))
    return { items: items.map(i => ({ ...i, price: toPrice(map.get(i.guid)) })), pricesAvailable: true }
  }
  catch (e) {
    console.error(`[catalog] prices: ${(e as Error).message}`)
    return { items: items.map(i => ({ ...i, price: null })), pricesAvailable: false }
  }
}

export async function catalogPage(store: CatalogStore, query: CatalogQuery, clientGuid: string | null, prices: PriceSource) {
  const { items, total } = store.search(query)
  const priced = await withPrices(items, clientGuid, prices)
  return { ...priced, total }
}

export async function catalogItem(store: CatalogStore, guid: string, clientGuid: string | null, prices: PriceSource) {
  const item = store.item(guid)
  if (!item) return null
  const all = await withPrices([item, ...item.analogs], clientGuid, prices)
  const [main, ...analogs] = all.items as (PricedItem & Partial<CatalogItemDetails>)[]
  return { item: { ...item, price: main!.price, analogs }, pricesAvailable: all.pricesAvailable }
}
