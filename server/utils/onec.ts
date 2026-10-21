/**
 * Клиент 1С для приложения: при `ONEC_MOCK=true` — внутрипроцессный мок по тому же контракту,
 * иначе — `ONEC_URL` + `ONEC_TOKEN`. Переключение на реальную 1С — только окружением, без кода
 * (docs/project.md). Мок живёт в процессе, а не по HTTP к самому себе: серверу не нужно знать
 * свой адрес и порт, а запросы проходят тот же `fetch`-путь, сериализацию JSON и проверку схемой.
 */
import { randomUUID } from 'node:crypto'
import { createMockState, type MockState } from '../mocks/onec/mock'
import { mockFetch } from '../mocks/onec/fetch'
import { OnecClient, type OnecApi } from '../services/onec'
import { DEFAULT_STOCK_WAREHOUSES, ODataClient } from '../services/onecOdata'
import { OdataOnec } from '../services/onecOdataSource'
import { sqliteVersionStore } from './odataVersions'
import { createOnecGuard } from './onecGuard'

/** Один на процесс: очередь «по одному» и пауза после сбоев общие для всех потоков ЛК (§1.8). */
const guard = createOnecGuard()

/** Состояние защиты 1С — для оповещений и страницы «Состояние системы». */
export const onecGuardState = () => guard.state()
export const onecGuardReset = () => guard.reset()

let mockState: MockState | undefined

/**
 * Без ONEC_TOKEN мок закрыт снаружи: токен случайный на процесс, его знает только клиент ЛК
 * внутри процесса. Известный токен по умолчанию открыл бы `/mock-1c/_admin/*` на демо-стенде всем.
 */
const processToken = randomUUID()

/** Состояние мока одно на процесс: маршрут `/mock-1c/*` и клиент ЛК видят одни и те же данные. */
export function getMockState(): MockState {
  const token = readServerEnv().onecToken || processToken
  if (!mockState || mockState.token !== token) mockState = createMockState(token, 1, readServerEnv().onecMockClients)
  return mockState
}

let odata: { key: string, api: OdataOnec } | undefined

export function useOnec(): OnecApi {
  const env = readServerEnv()
  const log = (e: { method: string, path: string, status: number | null, ms: number, attempt: number, error?: string }) => {
    if (e.error) console.warn(`[onec] ${e.method} ${e.path} → ${e.status ?? e.error} за ${e.ms} мс, попытка ${e.attempt}`)
  }
  if (env.onecMock) {
    const state = getMockState()
    // Защита — и на моке: «сбой 1С» на стенде показывает ту же паузу, что будет на настоящей.
    return new OnecClient({ baseUrl: 'http://mock.local/mock-1c', token: state.token, fetch: guard.wrap(mockFetch(state)), log })
  }
  // Логин и пароль пользователя 1С (Basic) — если заданы; иначе Bearer-токен.
  const auth = env.onecLogin && env.onecPassword
    ? { kind: 'basic' as const, login: env.onecLogin, password: env.onecPassword }
    : env.onecToken ? { kind: 'bearer' as const, token: env.onecToken } : null
  if (!env.onecUrl || !auth) throw createError({ statusCode: 503, message: '1C is not configured: ONEC_URL and ONEC_TOKEN or ONEC_LOGIN/ONEC_PASSWORD' })
  if (env.onecMode === 'odata') {
    // Один на процесс: снимок прогона и версии объектов живут между страницами синхронизации.
    const key = `${env.onecUrl}|${auth.kind}|${env.onecPriceTypes.join(',')}|${env.onecStockWarehouses.join(',')}`
    if (odata?.key !== key) {
      const client = new ODataClient({
        baseUrl: env.onecUrl,
        auth,
        fetch: guard.wrap(fetch),
        timeoutMs: 120_000,
        stockWarehouses: env.onecStockWarehouses.length ? env.onecStockWarehouses : DEFAULT_STOCK_WAREHOUSES,
      })
      odata = { key, api: new OdataOnec(client, sqliteVersionStore(useDb()), { priceTypeNames: env.onecPriceTypes, log: line => console.info(line) }) }
    }
    return odata.api
  }
  return new OnecClient({ baseUrl: env.onecUrl, auth, log, fetch: guard.wrap(fetch) })
}
