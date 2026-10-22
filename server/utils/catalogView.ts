/**
 * Каталог глазами клиента: индекс + цены его договора. Чистые функции с внедряемыми
 * зависимостями — проверяются без сервера (tests/catalog.test.ts).
 *
 * Граница данных: GUID клиента в 1С берётся только по компании из сессии; из запроса — никогда.
 */
import type { PriceT } from '../../shared/onec/schemas'
import type { CatalogItem, CatalogItemDetails, CatalogQuery, CatalogStore } from './catalog'
import { SORTS } from './catalog'
import type { PriceStatus } from '../../shared/catalogView'

export interface ItemPrice { value: number, currency: string, vatRate: number }
export type Priced<T extends CatalogItem> = T & { price: ItemPrice | null }

/**
 * Состояние цен для экрана:
 * - `ok` — цены договора получены (у отдельных товаров цены может не быть — «по запросу»);
 * - `no-contract` — у компании нет GUID 1С: цен не будет, пока менеджер не привяжет клиента;
 * - `unavailable` — CRM или 1С сейчас не ответили, цены появятся позже.
 */
export type { PriceStatus } from '../../shared/catalogView'

export type PriceSource = (clientGuid: string, items: string[]) => Promise<Map<string, PriceT>>

/** Найденный GUID верен долго: меняется только при перепривязке к другому клиенту 1С. */
export const COMPANY_GUID_TTL_MS = 10 * 60_000
/** «GUID нет» — коротко: только что привязанный клиент должен увидеть цены через минуту, а не через десять. */
export const COMPANY_NO_GUID_TTL_MS = 60_000
const COMPANY_CACHE_MAX = 10_000

/** GUID компании в 1С: строка, `null` — не привязана; сбой CRM — исключение (не кэшируется). */
export function createCompanyGuidResolver(
  getCompany: (id: number) => Promise<{ onecGuid: string | null } | null>,
  now: () => number = Date.now,
) {
  const cache = new Map<number, { until: number, guid: string | null }>()
  return async (companyId: number): Promise<string | null> => {
    const hit = cache.get(companyId)
    if (hit && hit.until > now()) return hit.guid
    const company = await getCompany(companyId)
    const guid = company?.onecGuid?.toLowerCase() ?? null
    if (cache.size >= COMPANY_CACHE_MAX) cache.clear()
    cache.set(companyId, { until: now() + (guid ? COMPANY_GUID_TTL_MS : COMPANY_NO_GUID_TTL_MS), guid })
    return guid
  }
}

export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Параметры списка из строки запроса: всё лишнее и кривое отбрасывается, а не падает. */
export function parseCatalogQuery(q: Record<string, unknown>): CatalogQuery {
  const str = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined)
  const int = (v: unknown, min: number) => {
    const n = Number(str(v))
    return Number.isInteger(n) && n >= min ? n : undefined
  }
  const sort = str(q.sort)
  const section = str(q.section)
  return {
    q: str(q.q)?.slice(0, 100),
    section: section && GUID_RE.test(section) ? section : undefined,
    brand: str(q.brand)?.slice(0, 100) || undefined,
    inStock: str(q.inStock) === '1',
    sort: (SORTS as readonly string[]).includes(sort ?? '') ? sort as CatalogQuery['sort'] : undefined,
    offset: int(q.offset, 0),
    limit: int(q.limit, 1),
  }
}

const toPrice = (p: PriceT | undefined): ItemPrice | null => (p ? { value: p.price, currency: p.currency, vatRate: p.vatRate } : null)

/** Контекст клиента: GUID договора или почему цен нет. */
/** `contractGuid` — выбранное клиентом соглашение (#46); не из его соглашений — берётся основное. */
export type ClientPricing = { status: 'ok', clientGuid: string, contractGuid?: string | null } | { status: 'no-contract' | 'unavailable' }

async function withPrices<T extends CatalogItem>(items: T[], pricing: ClientPricing, prices: PriceSource): Promise<{ items: Priced<T>[], priceStatus: PriceStatus }> {
  const none = (status: PriceStatus) => ({ items: items.map(i => ({ ...i, price: null })), priceStatus: status })
  if (pricing.status !== 'ok') return none(pricing.status)
  if (items.length === 0) return none('ok')
  try {
    const map = await prices(pricing.clientGuid, items.map(i => i.guid))
    return { items: items.map(i => ({ ...i, price: toPrice(map.get(i.guid)) })), priceStatus: 'ok' }
  }
  catch {
    // Причина уже в журнале кэша цен; экран говорит «временно недоступны», а не рисует нули.
    return none('unavailable')
  }
}

export async function catalogPage(store: CatalogStore, query: CatalogQuery, pricing: ClientPricing, prices: PriceSource) {
  const { items, total } = store.search(query)
  return { ...(await withPrices(items, pricing, prices)), total }
}

export async function catalogItem(store: CatalogStore, guid: string, pricing: ClientPricing, prices: PriceSource) {
  const item = store.item(guid)
  if (!item) return null
  const { analogs, ...main } = item
  const priced = await withPrices<CatalogItem>([main, ...analogs], pricing, prices)
  const [first, ...pricedAnalogs] = priced.items
  const result: Priced<Omit<CatalogItemDetails, 'analogs'>> & { analogs: Priced<CatalogItem>[] } = { ...main, price: first!.price, analogs: pricedAnalogs }
  return { item: result, priceStatus: priced.priceStatus }
}

/**
 * Граница HTTP каталога: без сессии — 401 до любой работы; GUID клиента — по компании из сессии.
 * Сбой CRM — каталог без цен со статусом `unavailable`, а не 500.
 */
export async function resolvePricing(
  session: { companyId: number } | null,
  resolveGuid: (companyId: number) => Promise<string | null>,
): Promise<ClientPricing> {
  if (!session) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
  try {
    const guid = await resolveGuid(session.companyId)
    return guid ? { status: 'ok', clientGuid: guid } : { status: 'no-contract' }
  }
  catch (e) {
    console.error(`[catalog] company lookup failed: ${(e as Error).name}`)
    return { status: 'unavailable' }
  }
}
