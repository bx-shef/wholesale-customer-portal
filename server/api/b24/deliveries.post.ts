// Вкладка «Ближайшие доставки» на странице приложения: рейсы из 1С для сотрудников портала.
import { allowedHosts, normalizeHost } from '../../utils/managerTab'
import { DELIVERIES_DAYS, deliveriesRequestSchema, readDeliveries } from '../../utils/deliveriesTab'
import { deliveryCalendar } from '../../../shared/delivery'
import { portalUserCall } from '../../utils/portalUserCall'
import { loadAppAuth } from '../../utils/b24AppAuth'

const limiter = createRateLimiter(60, 60_000)

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const parsed = deliveriesRequestSchema.safeParse(await readBody(event).catch(() => null))
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Неверный запрос' })
  const env = readServerEnv()
  const hosts = allowedHosts(env.b24PortalHosts, loadAppAuth(useDb())?.domain)
  if (!hosts.includes(normalizeHost(parsed.data.domain) ?? '')) throw createError({ statusCode: 403, message: 'Портал не подключён к ЛК' })
  if (!limiter.take(clientIp(getRequestHeader(event, 'x-forwarded-for'), event.node.req.socket.remoteAddress, env.trustProxy))) throw createError({ statusCode: 429, message: 'Слишком часто, подождите минуту' })
  const result = await readDeliveries(parsed.data, { allowedHosts: hosts, userCall: portalUserCall, upcoming: (from, to) => useDelivery().upcoming(from, to), calendar: async now => deliveryCalendar(await cachedSchedules(), now, DELIVERIES_DAYS) })
  if (result.status !== 200) throw createError({ statusCode: result.status, message: result.body.error })
  return result.body
})
