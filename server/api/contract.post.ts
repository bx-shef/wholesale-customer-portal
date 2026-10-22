// Выбор соглашения клиентом (#46): только из действующих соглашений клиента сессии.
// Пустое значение — вернуться к основному. Выбор хранится в cookie на устройстве.
import { CONTRACT_COOKIE, parseContractCookie } from '../../shared/contractChoice'
import { selectContract } from '../utils/clients'

export default defineEventHandler(async (event) => {
  const ctx = await orderContext(event)
  takeLimit(limits.quote, ctx.session.contactId)
  const body = await readBody(event).catch(() => null) as { guid?: unknown } | null
  if (ctx.pricing.status !== 'ok') throw createError({ statusCode: 409, message: 'Соглашений нет' })
  const client = useClientStore().get(ctx.pricing.clientGuid)
  const r = selectContract(client, parseContractCookie(typeof body?.guid === 'string' ? body.guid : ''))
  if (!r.ok) throw createError({ statusCode: 400, message: 'Такого соглашения у вас нет' })
  if (r.reset) deleteCookie(event, CONTRACT_COOKIE, { path: '/' })
  else setCookie(event, CONTRACT_COOKIE, r.selected!, { path: '/', httpOnly: true, sameSite: 'lax', secure: !import.meta.dev, maxAge: 60 * 60 * 24 * 365 })
  return { selected: r.selected }
})
