// Обвязка маршрутов стенда 1С: закрыт без пароля, лимит неудачных попыток по IP.
import type { H3Event } from 'h3'
import { onecTestAllowed, standWriteAllowed, STAND_WRITE_HEADER } from './onecTestAuth'
import { createRateLimiter } from './rateLimit'

const failures = createRateLimiter(20, 15 * 60_000)

export function guardOnecTest(event: H3Event) {
  const env = readServerEnv()
  // Пароль не задан — стенда «нет»: 404, а не приглашение подобрать пароль.
  if (!env.onecTestPassword) throw createError({ statusCode: 404 })
  const ip = clientIp(getRequestHeader(event, 'x-forwarded-for'), event.node.req.socket.remoteAddress, env.trustProxy)
  // Страницы стенда не встраиваются в чужие сайты (кликджекинг) и не угадываются по типу.
  setResponseHeader(event, 'Content-Security-Policy', "frame-ancestors 'none'")
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  if (onecTestAllowed(getRequestHeader(event, 'authorization'), { login: env.onecTestLogin, password: env.onecTestPassword })) {
    if (!standWriteAllowed(event.method, getRequestHeader(event, STAND_WRITE_HEADER))) throw createError({ statusCode: 403, message: 'Запрос не со страницы стенда' })
    return
  }
  if (!failures.take(ip)) throw createError({ statusCode: 429, message: 'Слишком много попыток, подождите 15 минут' })
  setResponseHeader(event, 'WWW-Authenticate', 'Basic realm="1C test", charset="UTF-8"')
  throw createError({ statusCode: 401 })
}
