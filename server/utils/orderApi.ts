// Обвязка маршрутов корзины и заявок: сессия обязательна, компания и договор — только из сессии.
import type { H3Event } from 'h3'
import type { TripSchedule } from '../../shared/delivery'
import { createB24Orders, type B24Orders } from '../services/b24Orders'
import { createClientStore, type ClientStore } from './clients'
import { createOrderStore, type OrderStore } from './orders'
import { createRateLimiter } from './rateLimit'

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

/**
 * Расписание рейсов: одно на все города, кэш 10 минут (docs/spec.md §4 говорит «1 ч» — сокращено,
 * чтобы правка менеджера доходила быстро). Одновременные запросы ждут один ответ CRM; сбой
 * запоминается на минуту — лежащая CRM не получает по запросу на каждый экран корзины.
 */
const SCHEDULE_TTL_MS = 10 * 60_000
const SCHEDULE_FAIL_MS = 60_000
let schedule: { until: number, value: Promise<TripSchedule[]> } | undefined
export function cachedSchedules(now = Date.now()): Promise<TripSchedule[]> {
  if (schedule && schedule.until > now) return schedule.value
  const value = useB24Orders().schedules()
  schedule = { until: now + SCHEDULE_TTL_MS, value }
  value.catch(() => {
    if (schedule?.value === value) schedule.until = Date.now() + SCHEDULE_FAIL_MS
  })
  return value
}

/** Лимиты на контакт: заявки — 10 в час, пересчёт корзины — 60 в минуту, звонок — раз в 10 минут. */
export const limits = {
  orders: createRateLimiter(10, 60 * 60_000),
  quote: createRateLimiter(60, 60_000),
  callbackContact: createRateLimiter(1, 10 * 60_000),
  callbackCompany: createRateLimiter(5, 60 * 60_000),
}

export function takeLimit(limiter: ReturnType<typeof createRateLimiter>, key: string | number) {
  if (!limiter.take(String(key))) throw createError({ statusCode: 429, message: 'Слишком часто. Попробуйте через несколько минут.' })
}

export const orderContext = (event: H3Event) => catalogContext(event)
