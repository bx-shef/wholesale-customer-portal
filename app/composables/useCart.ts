/**
 * Корзина в браузере (localStorage): только GUID товара и количество. Цены, названия и итог
 * пересчитывает сервер (`/api/cart/quote`) — подделка в браузере ничего не меняет.
 * Ключ хранения — по компании: на общем компьютере корзина одной компании не уезжает в другую.
 */
import type { CartLineInput } from '~~/shared/cart'
import { CART_LINES_MAX } from '~~/shared/cart'

const KEY = 'wcp-cart'
let listening = false

export function useCart() {
  const lines = useState<CartLineInput[]>('cart-lines', () => [])
  const owner = useState<number | null>('cart-owner', () => null)
  const loaded = useState('cart-loaded', () => false)

  function storageKey() {
    return `${KEY}:${owner.value ?? 'anon'}`
  }

  function persist() {
    if (!import.meta.client) return
    try {
      localStorage.setItem(storageKey(), JSON.stringify(lines.value))
    }
    catch {
      // Приватный режим или нет места: корзина живёт до закрытия вкладки — это лучше, чем ошибка на клике.
    }
  }

  function read(): CartLineInput[] {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey()) ?? '[]')
      return Array.isArray(raw)
        ? raw.filter(l => typeof l?.guid === 'string' && Number(l?.qty) > 0).map(l => ({ guid: l.guid, qty: Number(l.qty) })).slice(0, CART_LINES_MAX)
        : []
    }
    catch {
      return []
    }
  }

  /** Привязать корзину к компании вошедшего и прочитать сохранённую. Только в браузере. */
  function load(companyId: number) {
    if (!import.meta.client) return
    if (loaded.value && owner.value === companyId) return
    owner.value = companyId
    lines.value = read()
    if (!listening) {
      listening = true
      // Другая вкладка поменяла корзину — подхватываем, а не затираем её своим старым списком.
      window.addEventListener('storage', (e) => {
        if (e.key === storageKey()) lines.value = read()
      })
    }
    loaded.value = true
  }

  function qtyOf(guid: string) {
    return lines.value.find(l => l.guid === guid)?.qty ?? 0
  }

  function setQty(guid: string, qty: number) {
    // Строка остаётся на своём месте: карточки в корзине не прыгают при «+» и «−».
    const i = lines.value.findIndex(l => l.guid === guid)
    if (qty <= 0) lines.value = lines.value.filter(l => l.guid !== guid)
    else if (i >= 0) lines.value = lines.value.map(l => (l.guid === guid ? { guid, qty } : l))
    else if (lines.value.length < CART_LINES_MAX) lines.value = [...lines.value, { guid, qty }]
    persist()
  }

  function clear() {
    lines.value = []
    persist()
  }

  /** Выход: корзина не остаётся следующему на общем компьютере. */
  function forget() {
    if (import.meta.client) {
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith(`${KEY}:`)) localStorage.removeItem(k)
      }
      catch { /* хранилище недоступно — чистить нечего */ }
    }
    lines.value = []
    owner.value = null
    loaded.value = false
  }

  const count = computed(() => lines.value.length)
  return { lines, count, loaded, load, qtyOf, setQty, clear, forget }
}
