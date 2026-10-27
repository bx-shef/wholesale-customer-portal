// Разделы и бренды для шторки фильтров.
export default defineEventHandler(async (event) => {
  const ctx = await catalogContext(event)
  return { sections: ctx.store.sections(), stockSections: ctx.store.stockSections(), itemSections: ctx.store.itemSections(), brands: ctx.store.brands() }
})
