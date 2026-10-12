// Список каталога: поиск, раздел, бренд, «в наличии», сортировка, страницы; цены — договора клиента.
export default defineEventHandler(async (event) => {
  const ctx = await catalogContext(event)
  return catalogPage(ctx.store, parseCatalogQuery(getQuery(event)), ctx.clientGuid, ctx.prices)
})
