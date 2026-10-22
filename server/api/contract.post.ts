// Выбор соглашения клиентом (#46): только из действующих соглашений клиента сессии.
// Пустое значение — вернуться к основному. Выбор хранится в cookie на устройстве.
import { CONTRACT_COOKIE, parseContractCookie } from '../../shared/contractChoice'

export default defineEventHandler(async (event) => {
  const ctx = await orderContext(event)
  takeLimit(limits.quote, ctx.session.contactId)
  const body = await readBody(event).catch(() => null) as { guid?: unknown } | null
  if (ctx.pricing.status !== 'ok') throw createError({ statusCode: 409, message: 'Соглашений нет' })
  const client = useClientStore().get(ctx.pricing.clientGuid)
  const wanted = parseContractCookie(typeof body?.guid === 'string' ? body.guid : '')
  if (!wanted) {
    deleteCookie(event, CONTRACT_COOKIE, { path: '/' })
    return { selected: client?.contract?.guid ?? null }
  }
  if (!client || client.deleted || !client.contracts.some(c => c.guid === wanted)) throw createError({ statusCode: 400, message: 'Такого соглашения у вас нет' })
  setCookie(event, CONTRACT_COOKIE, wanted, { path: '/', httpOnly: true, sameSite: 'lax', secure: !import.meta.dev, maxAge: 60 * 60 * 24 * 365 })
  return { selected: wanted }
})
