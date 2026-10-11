// Вход сотрудника клиента: логин + ключ → сессия в httpOnly cookie (docs/spec.md §3).
// Любой отказ — один текст; причина — в журнале входов (server/utils/login.ts).
export default defineEventHandler(async (event) => {
  const env = readServerEnv()
  if (env.sessionSecret.length < 32) throw createError({ statusCode: 503, message: 'Login is not configured: SESSION_SECRET' })
  // Только JSON: форма с чужого сайта (text/plain, urlencoded) сюда не дойдёт без CORS-предзапроса.
  if (!getRequestHeader(event, 'content-type')?.startsWith('application/json')) throw createError({ statusCode: 415 })
  const body: { login?: unknown, key?: unknown } = await readBody(event).catch(() => ({})) ?? {}
  const ip = getRequestIP(event, { xForwardedFor: env.trustProxy }) ?? 'unknown'

  const result = await login({ login: body.login, key: body.key, ip }, { directory: useAccessDirectory(), journal: sqliteLoginJournal(useDb()) })
  if (!result.ok) {
    const message = result.status === 429 ? 'Слишком много попыток. Попробуйте через 15 минут.'
      : result.status === 503 ? 'Вход временно недоступен. Попробуйте позже.'
        : 'Неверный логин или ключ доступа.'
    throw createError({ statusCode: result.status, message: message })
  }
  setCookie(event, SESSION_COOKIE, signSession({ contactId: result.contactId, companyId: result.companyId, accessId: result.accessId }, env.sessionSecret), {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SEC,
  })
  return { ok: true }
})
