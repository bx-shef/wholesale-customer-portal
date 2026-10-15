// Запустить поток обмена сейчас, не дожидаясь расписания. Возвращает итог запуска.
import { z } from 'zod'
import { createRateLimiter } from '../../utils/rateLimit'

const runs = createRateLimiter(60, 60 * 60_000)
const body = z.object({ flow: z.enum(['clients', 'catalog', 'prices', 'stock', 'orders']) })

export default defineEventHandler(async (event) => {
  guardOnecTest(event)
  const parsed = body.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Неизвестный поток' })
  // 1С хрупкая: ручных запусков — не больше 60 в час на всех.
  if (!runs.take('all')) throw createError({ statusCode: 429, message: 'Не больше 60 ручных запусков в час' })
  const started = Date.now()
  const run = await ({
    clients: () => syncCompanies(),
    catalog: () => syncCatalog(),
    prices: () => syncPrices(),
    stock: () => syncStock(),
    orders: () => runOrderSync(),
  })[parsed.data.flow]()
  console.info(`[system] manual run ${parsed.data.flow}`)
  return { flow: parsed.data.flow, ms: Date.now() - started, result: run }
})
