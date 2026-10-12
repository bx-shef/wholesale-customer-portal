// «Мои заявки» — только компании из сессии, новые сверху.
export default defineEventHandler(async (event) => {
  const ctx = await orderContext(event)
  const q = getQuery(event)
  return { items: useOrderStore().list(ctx.session.companyId, 20, Number(q.offset) || 0) }
})
