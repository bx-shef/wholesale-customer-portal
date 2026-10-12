// Карточка товара: свойства, остатки по складам, кратность, аналоги — с ценами клиента.
export default defineEventHandler(async (event) => {
  const ctx = await catalogContext(event)
  const guid = getRouterParam(event, 'guid') ?? ''
  if (!GUID_RE.test(guid)) throw createError({ statusCode: 404, message: 'Товар не найден' })
  const result = await catalogItem(ctx.store, guid, ctx.pricing, ctx.prices)
  if (!result) throw createError({ statusCode: 404, message: 'Товар не найден' })
  return result
})
