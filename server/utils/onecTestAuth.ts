/**
 * Доступ к стенду проверки 1С: Basic-авторизация браузера — логин `ONEC_TEST_LOGIN` (не задан —
 * любой) и пароль `ONEC_TEST_PASSWORD`. Пароль не задан — стенд закрыт для всех (fail-closed).
 */
import { bearerMatches } from './bearer'

export function basicCredentials(header: string | null | undefined): { login: string, password: string } | null {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header ?? '')
  if (!m) return null
  const decoded = Buffer.from(m[1]!, 'base64').toString('utf8')
  const i = decoded.indexOf(':')
  return i >= 0 ? { login: decoded.slice(0, i), password: decoded.slice(i + 1) } : null
}

export function onecTestAllowed(header: string | null | undefined, expected: { login: string, password: string }): boolean {
  const got = basicCredentials(header)
  if (!got) return false
  // Обе сверки — всегда, за постоянное время: по времени ответа не понять, что не сошлось.
  const passwordOk = bearerMatches(got.password, expected.password)
  const loginOk = !expected.login || bearerMatches(got.login, expected.login)
  return passwordOk && loginOk
}
