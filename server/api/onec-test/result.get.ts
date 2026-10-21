// Результат фонового прогона стенда 1С: страница опрашивает, пока статус `running`.
import { standJobs } from '../../utils/onecTestJobs'

export default defineEventHandler((event) => {
  guardOnecTest(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const id = String(getQuery(event).id ?? '')
  const job = /^[0-9a-f-]{36}$/.test(id) ? standJobs.get(id) : undefined
  if (!job) throw createError({ statusCode: 404, message: 'Прогон не найден — запустите заново' })
  if (job.status === 'failed') throw createError({ statusCode: 500, message: job.error })
  return job
})
