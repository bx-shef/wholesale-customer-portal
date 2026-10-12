/**
 * Корзина в браузере (localStorage): только GUID товара и количество. Цены, названия и итог
 * пересчитывает сервер (`/api/cart/quote`) — подделка в браузере ничего не меняет.
 * Ключ хранения — по компании: на общем компьютере корзина одной компании не уезжает в другую.
 */
import type { CartLineInput } from '~~/shared/cart'
import { CART_LINES_MAX } from '~~/shared/cart'

const KEY = 'wcp-cart'

export function useCart() {
  const lines = useState<CartLineInput[]>('cart-lines', () => [])
  const owner = useState<number | null>('cart-owner', () => null)
  const loaded = useState('cart-loaded', () => false)

  function storageKey() {
    return `${KEY}:${owner.value ?? 'anon'}`
  }

  function persist() {
    if (import.meta.client) localStorage.setItem(storageKey(), JSON.stringify(lines.value))
  }

  /** Привязать корзину к компании вошедшего и прочитать сохранённую. Только в браузере. */
  function load(companyId: number) {
    if (!import.meta.client) return
    if (loaded.value && owner.value === companyId) return
    owner.value = companyId
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey()) ?? '[]')
      lines.value = Array.isArray(raw)
        ? raw.filter(l => typeof l?.guid === 'string' && Number(l?.qty) > 0).map(l => ({ guid: l.guid, qty: Number(l.qty) })).slice(0, CART_LINES_MAX)
        : []
    }
    catch {
      lines.value = []
    }
    loaded.value = true
  }

  function qtyOf(guid: string) {
    return lines.value.find(l => l.guid === guid)?.qty ?? 0
  }

  function setQty(guid: string, qty: number) {
    const rest = lines.value.filter(l => l.guid !== guid)
    lines.value = qty > 0 ? [...rest, { guid, qty }].slice(-CART_LINES_MAX) : rest
    persist()
  }

  function clear() {
    lines.value = []
    persist()
  }

  const count = computed(() => lines.value.length)
  return { lines, count, load, qtyOf, setQty, clear }
}
