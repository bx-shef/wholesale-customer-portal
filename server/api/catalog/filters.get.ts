// Разделы и бренды для шторки фильтров.
export default defineEventHandler(async (event) => {
  const ctx = await catalogContext(event)
  return { sections: ctx.store.sections(), stockSections: ctx.store.stockSections(), brands: ctx.store.brands() }
})
