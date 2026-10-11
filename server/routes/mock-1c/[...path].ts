// Мок 1С по HTTP (docs/onec-contract.md) — для программиста 1С и контрактных тестов снаружи.
// Есть только при явном ONEC_MOCK=true: на сервере с реальной 1С маршрута нет вовсе (404).
// Доступ — Bearer ONEC_TOKEN, как у настоящего сервиса.
import { handleMockRequest } from '../../mocks/onec/mock'

export default defineEventHandler(async (event) => {
  if (!readServerEnv().onecMock) throw createError({ statusCode: 404 })
  const method = event.method
  const body = method === 'POST' ? await readBody(event).catch(() => undefined) : undefined
  const res = handleMockRequest(getMockState(), {
    method,
    path: '/' + (getRouterParam(event, 'path') ?? ''),
    query: getQuery(event) as Record<string, string | undefined>,
    body,
    authorization: getRequestHeader(event, 'authorization'),
  }, Date.now())
  if (res.delayMs > 0) await new Promise(resolve => setTimeout(resolve, res.delayMs))
  setResponseStatus(event, res.status)
  return res.body
})
