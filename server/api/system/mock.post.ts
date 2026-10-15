// Мок 1С: «как будто в 1С поменяли» — проверить, что обмен это подхватит (docs/MONITORING.md).
// Только при ONEC_MOCK=true: на настоящей 1С этих кнопок нет.
import { z } from 'zod'
import { handleMockRequest } from '../../mocks/onec/mock'

const body = z.object({ action: z.enum(['price', 'debt', 'item', 'client', 'fail', 'heal', 'reset']) })

export default defineEventHandler(async (event) => {
  guardOnecTest(event)
  if (!readServerEnv().onecMock) throw createError({ statusCode: 409, message: 'Работает настоящая 1С — управление моком выключено' })
  const parsed = body.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Неизвестное действие' })
  const state = getMockState()
  const admin = (path: string, payload: Record<string, unknown> = {}) =>
    handleMockRequest(state, { method: 'POST', path, query: {}, body: payload, authorization: `Bearer ${state.token}` }, Date.now())
  const res = ({
    price: () => admin('/_admin/price', { count: 3, factor: 1.05 }),
    debt: () => admin('/_admin/debt', { add: 100 }),
    item: () => admin('/_admin/item', { index: 1 }),
    client: () => admin('/_admin/client', {}),
    fail: () => admin('/_admin/mode', { failNext: 6 }),
    heal: () => {
      onecGuardReset()
      return admin('/_admin/mode', { failNext: 0, failRate: 0, delayMs: 0 })
    },
    reset: () => admin('/_admin/reset', {}),
  })[parsed.data.action]()
  console.info(`[system] mock ${parsed.data.action}`)
  return { action: parsed.data.action, status: res.status, body: res.body }
})
