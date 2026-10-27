// Характеристики для фильтра (цвет, объём, вес…) — в выбранном разделе или во всём каталоге.
import { GUID_RE } from '../../utils/catalogView'

export default defineEventHandler(async (event) => {
  const ctx = await catalogContext(event)
  const section = getQuery(event).section
  return { facets: ctx.store.facets(typeof section === 'string' && GUID_RE.test(section) ? section : undefined) }
})
