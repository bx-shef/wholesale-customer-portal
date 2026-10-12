// Пересчёт корзины на сервере: цены договора, кратность, остатки, итог.
export default defineEventHandler(async (event) => {
  const ctx = await orderContext(event)
  takeLimit(limits.quote, ctx.session.contactId)
  return quoteCart(parseCartLines(await readBody(event)), ctx.store, ctx.pricing, ctx.prices)
})
