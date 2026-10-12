/**
 * Цены клиента (docs/spec.md §4: `POST /prices`, кэш 15 минут). Цена — по договору компании из
 * сессии; чужую цену клиент не увидит, потому что `clientGuid` берётся только из CRM по компании
 * сессии, а кэш разделён по клиенту.
 *
 * - В 1С — пачкой только недостающие товары: страница каталога — один запрос, а не 30.
 * - Одинаковые запросы, пришедшие одновременно, ждут один ответ 1С, а не идут дублями.
 * - 1С не ответила — следующие PRICE_FAILURE_PAUSE_MS не спрашиваем её снова по этому клиенту:
 *   лежащая 1С не должна получать по запросу на каждую страницу каждого клиента.
 * - Переполнение вытесняет самые старые записи, а не весь кэш разом.
 */
import type { PriceT } from '../../shared/onec/schemas'
import { PAGE_SIZE_MAX } from '../../shared/onec/schemas'

export const PRICE_TTL_MS = 15 * 60_000
export const PRICE_FAILURE_PAUSE_MS = 30_000
export const PRICE_CACHE_MAX = 50_000

export type PriceLoader = (clientGuid: string, itemGuids: string[]) => Promise<PriceT[]>

export class PricesUnavailableError extends Error {
  constructor() {
    super('1C prices are temporarily unavailable')
    this.name = 'PricesUnavailableError'
  }
}

export function createPriceCache(load: PriceLoader, now: () => number = Date.now, max = PRICE_CACHE_MAX) {
  // Значение null — «у клиента нет цены на товар»: тоже кэшируем, иначе такие товары спрашивали бы каждый раз.
  // Map хранит порядок вставки: первая запись — самая старая, её и вытесняем.
  const cache = new Map<string, { until: number, price: PriceT | null }>()
  const inFlight = new Map<string, Promise<void>>()
  const failedUntil = new Map<string, number>()
  const key = (client: string, item: string) => `${client}|${item}`

  function put(k: string, value: { until: number, price: PriceT | null }) {
    cache.delete(k)
    cache.set(k, value)
    while (cache.size > max) cache.delete(cache.keys().next().value!)
  }

  async function fetchBatch(client: string, batch: string[]) {
    const prices = await load(client, batch)
    const byItem = new Map(prices.map(p => [p.itemGuid.toLowerCase(), p]))
    const until = now() + PRICE_TTL_MS
    for (const g of batch) put(key(client, g), { until, price: byItem.get(g) ?? null })
  }

  return {
    /** Бросает PricesUnavailableError, если 1С недоступна (или недавно была). */
    async get(clientGuid: string, itemGuids: string[]): Promise<Map<string, PriceT>> {
      const client = clientGuid.toLowerCase()
      const wanted = [...new Set(itemGuids.map(g => g.toLowerCase()))]
      const t = now()
      const fresh = (g: string) => (cache.get(key(client, g))?.until ?? 0) > t
      const waits: Promise<void>[] = []
      const missing: string[] = []
      for (const g of wanted) {
        if (fresh(g)) continue
        const pending = inFlight.get(key(client, g))
        if (pending) waits.push(pending)
        else missing.push(g)
      }
      if (missing.length && (failedUntil.get(client) ?? 0) > t) throw new PricesUnavailableError()
      for (let i = 0; i < missing.length; i += PAGE_SIZE_MAX) {
        const batch = missing.slice(i, i + PAGE_SIZE_MAX)
        const p = fetchBatch(client, batch).finally(() => {
          for (const g of batch) inFlight.delete(key(client, g))
        })
        for (const g of batch) inFlight.set(key(client, g), p)
        waits.push(p)
      }
      const results = await Promise.allSettled(waits)
      const failure = results.find(r => r.status === 'rejected')
      if (failure) {
        failedUntil.set(client, now() + PRICE_FAILURE_PAUSE_MS)
        console.error(`[prices] ${(failure as PromiseRejectedResult).reason?.name ?? 'Error'}`)
        throw new PricesUnavailableError()
      }
      failedUntil.delete(client)
      const out = new Map<string, PriceT>()
      for (const g of wanted) {
        const p = cache.get(key(client, g))?.price
        if (p) out.set(g, p)
      }
      return out
    },
    clear() {
      cache.clear()
      failedUntil.clear()
    },
  }
}
