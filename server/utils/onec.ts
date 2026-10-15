/**
 * Клиент 1С для приложения: при `ONEC_MOCK=true` — внутрипроцессный мок по тому же контракту,
 * иначе — `ONEC_URL` + `ONEC_TOKEN`. Переключение на реальную 1С — только окружением, без кода
 * (docs/project.md). Мок живёт в процессе, а не по HTTP к самому себе: серверу не нужно знать
 * свой адрес и порт, а запросы проходят тот же `fetch`-путь, сериализацию JSON и проверку схемой.
 */
import { randomUUID } from 'node:crypto'
import { createMockState, type MockState } from '../mocks/onec/mock'
import { mockFetch } from '../mocks/onec/fetch'
import { OnecClient } from '../services/onec'
import { createOnecGuard } from './onecGuard'

/** Один на процесс: очередь «по одному» и пауза после сбоев общие для всех потоков ЛК (§1.8). */
const guard = createOnecGuard()

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

export function useOnec(): OnecClient {
  const env = readServerEnv()
  const log = (e: { method: string, path: string, status: number | null, ms: number, attempt: number, error?: string }) => {
    if (e.error) console.warn(`[onec] ${e.method} ${e.path} → ${e.status ?? e.error} за ${e.ms} мс, попытка ${e.attempt}`)
  }
  if (env.onecMock) {
    const state = getMockState()
    return new OnecClient({ baseUrl: 'http://mock.local/mock-1c', token: state.token, fetch: mockFetch(state), log })
  }
  // Логин и пароль пользователя 1С (Basic) — если заданы; иначе Bearer-токен.
  const auth = env.onecLogin && env.onecPassword
    ? { kind: 'basic' as const, login: env.onecLogin, password: env.onecPassword }
    : env.onecToken ? { kind: 'bearer' as const, token: env.onecToken } : null
  if (!env.onecUrl || !auth) throw createError({ statusCode: 503, message: '1C is not configured: ONEC_URL and ONEC_TOKEN or ONEC_LOGIN/ONEC_PASSWORD' })
  return new OnecClient({ baseUrl: env.onecUrl, auth, log, fetch: guard.wrap(fetch) })
}
