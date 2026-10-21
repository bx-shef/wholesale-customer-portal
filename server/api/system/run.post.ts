// Запустить поток обмена сейчас, не дожидаясь расписания. Идёт в фоне: итог — в таблице запусков.
import { z } from 'zod'
import { manualRunVerdict } from '../../utils/manualRun'

const running = new Set<string>()
const lastStartedAt = new Map<string, number>()
const body = z.object({ flow: z.enum(['clients', 'catalog', 'prices', 'stock', 'orders', 'schedule', 'trips']) })

export default defineEventHandler(async (event) => {
  guardOnecTest(event)
  const parsed = body.safeParse(await readBody(event).catch(() => null))
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Неизвестный поток' })
  const flow = parsed.data.flow
  // В режиме OData часть потоков ещё не сделана: ручной запуск записал бы сбой, которого никто не увидит.
  // Заявки — исключение: без заказов в 1С досылка в CRM и отчёт в сделки всё равно нужны.
  if (flow !== 'orders' && onecUnsupportedFlows().includes(flow)) throw createError({ statusCode: 409, message: 'Этот обмен по OData ещё не сделан' })
  const now = Date.now()
  const verdict = manualRunVerdict(flow, running, lastStartedAt.get(flow), now)
  if (!verdict.ok) {
    throw createError({
      statusCode: verdict.reason === 'busy' ? 409 : 429,
      message: verdict.reason === 'busy' ? 'Этот обмен уже идёт' : `Бережём 1С: повторить можно через ${Math.ceil(verdict.retryInMs / 60_000)} мин`,
    })
  }
  running.add(flow)
  lastStartedAt.set(flow, now)
  const job = {
    clients: () => syncCompanies(),
    catalog: () => syncCatalog(),
    prices: () => syncPrices(),
    stock: () => syncStock(),
    orders: () => runOrderSync(),
    schedule: () => syncDeliverySchedule(),
    trips: () => syncTrips(),
  }[flow]
  console.info(`[system] manual run ${flow}`)
  void Promise.resolve().then(job)
    .catch(e => console.warn(`[system] manual run ${flow} failed: ${e instanceof Error ? e.name : 'Error'}`))
    .finally(() => running.delete(flow))
  setResponseStatus(event, 202)
  return { flow, started: true }
})
