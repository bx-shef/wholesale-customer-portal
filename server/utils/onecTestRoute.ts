// Обвязка маршрутов стенда 1С: закрыт без пароля, лимит неудачных попыток по IP.
import type { H3Event } from 'h3'
import { onecTestAllowed } from './onecTestAuth'
import { createRateLimiter } from './rateLimit'

const failures = createRateLimiter(20, 15 * 60_000)

export function guardOnecTest(event: H3Event) {
  const env = readServerEnv()
  // Пароль не задан — стенда «нет»: 404, а не приглашение подобрать пароль.
  if (!env.onecTestPassword) throw createError({ statusCode: 404 })
  const ip = clientIp(getRequestHeader(event, 'x-forwarded-for'), event.node.req.socket.remoteAddress, env.trustProxy)
  if (onecTestAllowed(getRequestHeader(event, 'authorization'), { login: env.onecTestLogin, password: env.onecTestPassword })) return
  if (!failures.take(ip)) throw createError({ statusCode: 429, message: 'Слишком много попыток, подождите 15 минут' })
  setResponseHeader(event, 'WWW-Authenticate', 'Basic realm="1C test", charset="UTF-8"')
  throw createError({ statusCode: 401 })
}
