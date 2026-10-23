// Пауза автосинхронизации с 1С (кнопка на «Состоянии системы»). Ручной запуск потоков работает и на паузе.
import { z } from 'zod'

const body = z.object({ paused: z.boolean() })

export default defineEventHandler(async (event) => {
  guardOnecTest(event)
  const parsed = body.safeParse(await readBody(event).catch(() => null))
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Ожидается { paused: true|false }' })
  writeAutoSyncPaused(useDb(), parsed.data.paused, new Date().toISOString())
  console.info(`[system] auto sync ${parsed.data.paused ? 'paused' : 'resumed'}`)
  return readAutoSyncPaused(useDb())
})
