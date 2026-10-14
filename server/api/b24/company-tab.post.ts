// Вкладка «Личный кабинет» в карточке компании: список контактов, выдача и отзыв ключа.
// Авторизация — токен фрейма сотрудника, проверенный порталом (server/utils/managerTab.ts).
import { listCompanyContacts } from '../../services/b24Access'
import { allowedHosts, runTabAction, tabRequestSchema } from '../../utils/managerTab'
import { portalUserCall } from '../../utils/portalUserCall'

const limiter = createRateLimiter(60, 60_000)

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const parsed = tabRequestSchema.safeParse(await readBody(event).catch(() => null))
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Неверный запрос' })
  if (!limiter.take(`${parsed.data.domain}|${parsed.data.companyId}`)) throw createError({ statusCode: 429, message: 'Слишком часто, подождите минуту' })
  const env = readServerEnv()
  const result = await runTabAction(parsed.data, {
    allowedHosts: allowedHosts(env.b24PortalHosts, env.b24WebhookUrl),
    userCall: portalUserCall,
    dir: useAccessDirectory(),
    listCompanyContacts: id => listCompanyContacts(useB24Call(), id),
    forgetAccess: forgetAccessCheck,
  })
  if (result.status !== 200) throw createError({ statusCode: result.status, message: (result.body as { error: string }).error })
  return result.body
})
