// Обвязка маршрутов корзины и заявок: сессия обязательна, компания и договор — только из сессии.
import type { H3Event } from 'h3'
import { createB24Orders, type B24Orders, type Trip } from '../services/b24Orders'
import { createClientStore, type ClientStore } from './clients'
import { createOrderStore, type OrderStore } from './orders'

let orders: OrderStore | undefined
let clients: ClientStore | undefined
let b24: { url: string, api: B24Orders } | undefined

export function useOrderStore(): OrderStore {
  orders ??= createOrderStore(useDb())
  return orders
}
export function useClientStore(): ClientStore {
  clients ??= createClientStore(useDb())
  return clients
}
export function useB24Orders(): B24Orders {
  const url = readServerEnv().b24WebhookUrl
  if (b24?.url !== url) b24 = { url, api: createB24Orders((m, p) => useB24Call()(m, p)) }
  return b24.api
}

/** Рейсы меняются редко (docs/spec.md §4: кэш 1 ч); 10 минут — чтобы новый рейс менеджера появился быстро. */
const TRIP_TTL_MS = 10 * 60_000
const trips = new Map<string, { until: number, trip: Trip | null }>()
export async function cachedNearestTrip(city: string, now = new Date()): Promise<Trip | null> {
  const key = city.trim().toLowerCase()
  const hit = trips.get(key)
  // Кэш не держит рейс, у которого уже закрылся приём заявок.
  if (hit && hit.until > now.getTime() && (!hit.trip || Date.parse(hit.trip.cutoffAt) > now.getTime())) return hit.trip
  const trip = await useB24Orders().nearestTrip(city, now)
  if (trips.size > 1000) trips.clear()
  trips.set(key, { until: now.getTime() + TRIP_TTL_MS, trip })
  return trip
}

export const orderContext = (event: H3Event) => catalogContext(event)
