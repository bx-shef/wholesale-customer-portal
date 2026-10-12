// Общая обвязка маршрутов каталога: сессия обязательна, GUID клиента — по компании из сессии.
import type { H3Event } from 'h3'
import { createCompanyGuidResolver, resolvePricing } from './catalogView'

let resolver: ReturnType<typeof createCompanyGuidResolver> | undefined

export async function catalogContext(event: H3Event) {
  resolver ??= createCompanyGuidResolver(id => useAccessDirectory().getCompany(id))
  const session = await resolveClientSession(event)
  if (!session) throw createError({ statusCode: 401 })
  // Цены договора — только этому клиенту: ни браузер, ни прокси не должны их кэшировать.
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const pricing = await resolvePricing(session, resolver)
  const prices = (guid: string, items: string[]) => usePrices().get(guid, items)
  return { session, pricing, prices, store: useCatalog() }
}
