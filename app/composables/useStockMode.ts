import type { StockMode } from '~~/shared/cart'

/** Режим заказа сверх остатка из «кто вошёл» (`/api/auth/me`); пока не прочитан — строгий `stock`. */
export function useStockMode() {
  const me = useNuxtData<{ stockMode?: StockMode }>('me')
  return computed<StockMode>(() => me.data.value?.stockMode ?? 'stock')
}
