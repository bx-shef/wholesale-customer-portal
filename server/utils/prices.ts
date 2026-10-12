/**
 * Цены клиента (docs/spec.md §4: `POST /prices`, кэш 15 минут). Цена — по договору компании из
 * сессии; чужую цену клиент не увидит, потому что `clientGuid` берётся только из CRM по компании
 * сессии, а кэш разделён по клиенту.
 *
 * Запрос в 1С — пачкой только на недостающие товары: страница каталога — один запрос, а не 30.
 */
import type { PriceT } from '../../shared/onec/schemas'
import { PAGE_SIZE_MAX } from '../../shared/onec/schemas'

export const PRICE_TTL_MS = 15 * 60_000
const CACHE_MAX = 50_000

export type PriceLoader = (clientGuid: string, itemGuids: string[]) => Promise<PriceT[]>

export function createPriceCache(load: PriceLoader, now: () => number = Date.now) {
  // Значение null — «у клиента нет цены на товар»: тоже кэшируем, иначе такие товары спрашивали бы каждый раз.
  const cache = new Map<string, { until: number, price: PriceT | null }>()
  const key = (client: string, item: string) => `${client.toLowerCase()}|${item.toLowerCase()}`

  return {
    async get(clientGuid: string, itemGuids: string[]): Promise<Map<string, PriceT>> {
      const t = now()
      const wanted = [...new Set(itemGuids.map(g => g.toLowerCase()))]
      const missing = wanted.filter(g => (cache.get(key(clientGuid, g))?.until ?? 0) <= t)
      for (let i = 0; i < missing.length; i += PAGE_SIZE_MAX) {
        const batch = missing.slice(i, i + PAGE_SIZE_MAX)
        const prices = await load(clientGuid, batch)
        const byItem = new Map(prices.map(p => [p.itemGuid.toLowerCase(), p]))
        if (cache.size > CACHE_MAX) cache.clear()
        for (const g of batch) cache.set(key(clientGuid, g), { until: t + PRICE_TTL_MS, price: byItem.get(g) ?? null })
      }
      const out = new Map<string, PriceT>()
      for (const g of wanted) {
        const p = cache.get(key(clientGuid, g))?.price
        if (p) out.set(g, p)
      }
      return out
    },
    clear() { cache.clear() },
  }
}
