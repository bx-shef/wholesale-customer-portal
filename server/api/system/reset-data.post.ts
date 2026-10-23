// Очистка данных обмена перед первой выгрузкой из настоящей 1С (кнопка на «Состоянии системы»).
import { z } from 'zod'

const body = z.object({ confirm: z.literal('ОЧИСТИТЬ') })

export default defineEventHandler(async (event) => {
  guardOnecTest(event)
  if (!body.safeParse(await readBody(event).catch(() => null)).success) throw createError({ statusCode: 400, message: 'Нужно подтверждение: confirm = «ОЧИСТИТЬ»' })
  // На моке очистка бессмысленна: расписание тут же зальёт демо-данные обратно.
  if (readServerEnv().onecMock) throw createError({ statusCode: 409, message: 'Включён мок 1С — очищать нечего' })
  const removed = resetSyncData(useDb())
  console.info(`[system] sync data reset: ${JSON.stringify(removed)}`)
  return { removed }
})
