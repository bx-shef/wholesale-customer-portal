// «Заказать звонок»: дело ответственному за компанию. Раз в 10 минут на контакт, 5 в час на компанию.
import { neutralizeBb } from '../../shared/cart'
export default defineEventHandler(async (event) => {
  const session = await resolveClientSession(event)
  if (!session) throw createError({ statusCode: 401 })
  if (!readServerEnv().callbackEnabled) throw createError({ statusCode: 404, message: 'Заказ звонка выключен' })
  // Место резервируется до похода в CRM: параллельные клики не создают двух дел.
  if (!limits.callbackContact.take(String(session.contactId))) return { ok: true, repeated: true }
  if (!limits.callbackCompany.take(String(session.companyId))) {
    limits.callbackContact.release(String(session.contactId))
    throw createError({ statusCode: 429, message: 'Просьба уже передана менеджеру. Он перезвонит.' })
  }
  try {
    const company = await useAccessDirectory().getCompany(session.companyId)
    const contact = await useB24Call()('crm.item.get', { entityTypeId: 3, id: session.contactId })
      .then(r => (r as { item?: Record<string, unknown> }).item)
      .catch(() => undefined)
    const name = [contact?.name, contact?.lastName].filter(v => typeof v === 'string' && v).join(' ')
    await useB24Orders().requestCallback({
      companyId: session.companyId,
      responsibleId: company?.assignedById ?? null,
      contactLabel: neutralizeBb(`${name || 'контакт'} (ID ${session.contactId})`),
    })
    return { ok: true, repeated: false }
  }
  catch (e) {
    // Не состоялось — место возвращаем, клиент может повторить.
    limits.callbackContact.release(String(session.contactId))
    limits.callbackCompany.release(String(session.companyId))
    console.error(`[callback] ${(e as Error).name}`)
    throw createError({ statusCode: 503, message: 'Не удалось передать просьбу. Позвоните менеджеру.' })
  }
})
