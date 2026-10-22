// Отправка заявки: сделка в воронке «Заявки ЛК» с товарами. Повтор с тем же requestId — та же заявка.
export default defineEventHandler(async (event) => {
  const ctx = await orderContext(event)
  const body = await readBody(event) as { requestId?: unknown, addressGuid?: unknown, comment?: unknown }
  // Лимит — на попытку, а не на успех: перебор UUID не плодит строк в базе и запросов к CRM.
  takeLimit(limits.orders, ctx.session.contactId)
  const result = await submitOrder(ctx.session, ctx.pricing, {
    requestId: typeof body?.requestId === 'string' ? body.requestId : '',
    addressGuid: typeof body?.addressGuid === 'string' ? body.addressGuid : '',
    comment: typeof body?.comment === 'string' ? body.comment : '',
    lines: parseCartLines(body),
  }, { store: ctx.store, clients: useClientStore(), orders: useOrderStore(), b24: useB24Orders(), schedules: () => cachedSchedules(), prices: ctx.prices, companyTitle: async id => (await useAccessDirectory().getCompany(id))?.title ?? null })
  if (!result.ok) setResponseStatus(event, result.status)
  return result
})
