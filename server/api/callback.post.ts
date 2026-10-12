// «Заказать звонок»: дело ответственному за компанию. Не чаще раза в 10 минут на контакт.
const CALLBACK_PAUSE_MS = 10 * 60_000
const recent = new Map<number, number>()

export default defineEventHandler(async (event) => {
  const session = await resolveClientSession(event)
  if (!session) throw createError({ statusCode: 401 })
  const now = Date.now()
  if ((recent.get(session.contactId) ?? 0) > now) return { ok: true, repeated: true }
  try {
    const company = await useAccessDirectory().getCompany(session.companyId)
    const contact = await useB24Call()('crm.item.get', { entityTypeId: 3, id: session.contactId })
      .then(r => (r as { item?: Record<string, unknown> }).item)
      .catch(() => undefined)
    const name = [contact?.name, contact?.lastName].filter(Boolean).join(' ')
    await useB24Orders().requestCallback({
      companyId: session.companyId,
      responsibleId: company?.assignedById ?? null,
      contactLabel: `${name || 'контакт'} (ID ${session.contactId})`,
    })
    if (recent.size > 10_000) recent.clear()
    recent.set(session.contactId, now + CALLBACK_PAUSE_MS)
    return { ok: true, repeated: false }
  }
  catch (e) {
    console.error(`[callback] ${(e as Error).message}`)
    throw createError({ statusCode: 503, message: 'Не удалось передать просьбу. Позвоните менеджеру.' })
  }
})
