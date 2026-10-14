// Вкладка «Личный кабинет» в карточке компании: список контактов, выдача и отзыв ключа.
// Авторизация — токен фрейма сотрудника, проверенный порталом (server/utils/managerTab.ts).
import { listCompanyContacts } from '../../services/b24Access'
import { allowedHosts, normalizeHost, runTabAction, tabRequestSchema } from '../../utils/managerTab'
import { portalUserCall } from '../../utils/portalUserCall'

const limiter = createRateLimiter(60, 60_000)

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const parsed = tabRequestSchema.safeParse(await readBody(event).catch(() => null))
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Неверный запрос' })
  const env = readServerEnv()
  const hosts = allowedHosts(env.b24PortalHosts, env.b24WebhookUrl)
  // Чужой хост отсекаем до лимита и до похода в портал: иначе вариации домена плодили бы ключи
  // лимитера. Лимит — по адресу клиента: токен ещё не проверен, доверять companyId нельзя.
  if (!hosts.includes(normalizeHost(parsed.data.domain) ?? '')) throw createError({ statusCode: 403, message: 'Портал не подключён к ЛК' })
  if (!limiter.take(clientIp(getRequestHeader(event, 'x-forwarded-for'), event.node.req.socket.remoteAddress, env.trustProxy))) throw createError({ statusCode: 429, message: 'Слишком часто, подождите минуту' })
  const result = await runTabAction(parsed.data, {
    allowedHosts: hosts,
    userCall: portalUserCall,
    dir: useAccessDirectory(),
    listCompanyContacts: (id, call) => listCompanyContacts(call, id),
    forgetAccess: forgetAccessCheck,
  })
  if (result.status !== 200) throw createError({ statusCode: result.status, message: (result.body as { error: string }).error })
  return result.body
})
