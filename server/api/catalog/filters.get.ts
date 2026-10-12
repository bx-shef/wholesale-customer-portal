// Разделы и бренды для шторки фильтров.
export default defineEventHandler(async (event) => {
  const ctx = await catalogContext(event)
  return { sections: ctx.store.sections(), brands: ctx.store.brands() }
})
