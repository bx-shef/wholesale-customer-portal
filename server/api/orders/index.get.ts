// «Мои заявки» — только компании из сессии, новые сверху.
export default defineEventHandler(async (event) => {
  const ctx = await orderContext(event)
  return { items: useOrderStore().list(ctx.session.companyId, 20, Number(getQuery(event).offset)) }
})
