// Стенд проверки сервиса 1С: прогон контракта против адреса и токена из формы (docs/onec-contract.md §3).
import { z } from 'zod'
import { mockFetch } from '../mocks/onec/fetch'
import { checkBaseUrl, runOnecProbe } from '../utils/onecProbe'
import { fieldsText, runODataProbe } from '../utils/odataProbe'
import { createRateLimiter } from '../utils/rateLimit'

const runs = createRateLimiter(30, 60 * 60_000)
const body = z.object({
  target: z.enum(['onec', 'odata', 'mock']),
  baseUrl: z.string().max(500).optional(),
  authKind: z.enum(['bearer', 'basic']).default('bearer'),
  token: z.string().max(500).optional(),
  login: z.string().max(200).optional(),
  password: z.string().max(500).optional(),
  allowOrder: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  guardOnecTest(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const parsed = body.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Неверный запрос' })
  if (!runs.take('all')) throw createError({ statusCode: 429, message: 'Не больше 30 прогонов в час' })
  const started = Date.now()
  if (parsed.data.target === 'mock') {
    // Мок ЛК — в процессе: сетевой круг через свой же домен не нужен.
    const state = getMockState()
    const checks = await runOnecProbe({ baseUrl: 'http://mock.local/mock-1c', auth: { kind: 'bearer', token: state.token }, allowOrder: parsed.data.allowOrder === true, fetch: mockFetch(state) })
    return { target: 'мок ЛК', ms: Date.now() - started, checks }
  }
  const baseUrl = checkBaseUrl(parsed.data.baseUrl ?? '')
  if (!baseUrl) throw createError({ statusCode: 400, message: 'Адрес сервиса — https://… без логина, параметров и #' })
  const d = parsed.data
  const auth = d.authKind === 'basic'
    ? { kind: 'basic' as const, login: (d.login ?? '').trim(), password: d.password ?? '' }
    : { kind: 'bearer' as const, token: (d.token ?? '').trim() }
  if (auth.kind === 'basic' ? !auth.login || !auth.password : !auth.token) throw createError({ statusCode: 400, message: auth.kind === 'basic' ? 'Укажите логин и пароль' : 'Укажите токен' })
  if (d.target === 'odata') {
    const checks = await runODataProbe({ baseUrl, auth, fetch })
    console.info(`[onec-test] odata ${new URL(baseUrl).host}: ${checks.filter(c => c.status === 'ok').length}/${checks.length} ok`)
    return { target: baseUrl, ms: Date.now() - started, checks, fieldsText: fieldsText(checks) }
  }
  const checks = await runOnecProbe({ baseUrl, auth, allowOrder: parsed.data.allowOrder === true, fetch })
  console.info(`[onec-test] ${new URL(baseUrl).host}: ${checks.filter(c => c.status === 'ok').length}/${checks.length} ok`)
  return { target: baseUrl, ms: Date.now() - started, checks }
})
