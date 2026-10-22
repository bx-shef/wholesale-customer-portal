// Обвязка маршрутов корзины и заявок: сессия обязательна, компания и договор — только из сессии.
import type { H3Event } from 'h3'
import type { TripSchedule } from '../../shared/delivery'
import { createB24Orders, type B24Orders } from '../services/b24Orders'
import { loadAppAuth } from './b24AppAuth'
import { createClientStore, type ClientStore } from './clients'
import { createClientLoader, type ClientLoader } from './clientLoader'
import { CLIENT_DATA_FLOW } from './clientRefresh'
import { createOrderStore, type OrderStore } from './orders'
import { createRateLimiter } from './rateLimit'
import { sqliteSyncStore } from './onecSync'

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
let loader: ClientLoader | undefined
/** Данные клиента из 1С по GUID с кэшем (`ONEC_CLIENT_TTL_MIN`); один на процесс. */
export function useClientLoader(): ClientLoader {
  loader ??= createClientLoader({
    store: useClientStore(),
    load: guid => useOnec().clientByGuid(guid),
    ttlMs: readServerEnv().onecClientTtlMin * 60_000,
    // Сбой без кэша — запуск потока «клиенты» со сбоем: оповещение в Telegram идёт тем же путём.
    onFail: (_guid, e, cached, scheduled) => {
      console.error(`[clients] load failed${cached ? ' (cache used)' : ''}: ${e.name}`)
      if (!cached && !scheduled) recordClientFailure(e)
    },
  })
  return loader
}

/** Сбой без кэша при входе — в журнал потока не чаще этого: 1С в простое не засыпает журнал и Telegram. */
const FAILURE_RECORD_MS = 10 * 60_000
let lastFailureRecord = 0
function recordClientFailure(e: Error) {
  if (Date.now() - lastFailureRecord < FAILURE_RECORD_MS) return
  lastFailureRecord = Date.now()
  const at = new Date().toISOString()
  // Только класс ошибки: текст сетевого сбоя может содержать адрес 1С.
  void sqliteSyncStore(useDb()).saveRun({ flow: CLIENT_DATA_FLOW, status: 'failed', startedAt: at, finishedAt: at, cursorFrom: null, cursorTo: null, received: 0, error: `client load failed without cache: ${e.name}` })
}

export function useB24Orders(): B24Orders {
  // Кэш стадий и полей — на портал: переустановка на другой портал начинает с чистого листа.
  const url = loadAppAuth(useDb())?.memberId ?? ''
  if (b24?.url !== url) b24 = { url, api: createB24Orders((m, p) => useB24Call()(m, p)) }
  return b24.api
}

/** График доставки — из базы ЛК (его привозит из 1С `sync:schedule`): к 1С и CRM не ходим. */
export function cachedSchedules(): Promise<TripSchedule[]> {
  return Promise.resolve(useDelivery().schedules())
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
