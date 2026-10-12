// Отправка заявки: сделка в воронке «Заявки ЛК» с товарами. Повтор с тем же requestId — та же заявка.
export default defineEventHandler(async (event) => {
  const ctx = await orderContext(event)
  const body = await readBody(event) as { requestId?: unknown, addressGuid?: unknown, comment?: unknown }
  const result = await submitOrder(ctx.session, ctx.pricing, {
    requestId: typeof body?.requestId === 'string' ? body.requestId : '',
    addressGuid: typeof body?.addressGuid === 'string' ? body.addressGuid : '',
    comment: typeof body?.comment === 'string' ? body.comment : '',
    lines: parseCartLines(body),
  }, { store: ctx.store, clients: useClientStore(), orders: useOrderStore(), b24: useB24Orders(), prices: ctx.prices })
  if (!result.ok) setResponseStatus(event, result.status)
  return result
})
