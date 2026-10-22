// Общая обвязка маршрутов каталога: сессия обязательна, GUID клиента — по компании из сессии.
import type { H3Event } from 'h3'
import { createCompanyGuidResolver, resolvePricing } from './catalogView'
import { CONTRACT_COOKIE, parseContractCookie } from '../../shared/contractChoice'

let resolver: ReturnType<typeof createCompanyGuidResolver> | undefined

export async function catalogContext(event: H3Event) {
  resolver ??= createCompanyGuidResolver(id => useAccessDirectory().getCompany(id))
  const session = await resolveClientSession(event)
  if (!session) throw createError({ statusCode: 401 })
  // Цены договора — только этому клиенту: ни браузер, ни прокси не должны их кэшировать.
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const resolved = await resolvePricing(session, resolver)
  // Выбранное клиентом соглашение (#46): cookie — только подсказка, цены берутся лишь из
  // соглашений этого клиента (priceTypeOf), чужое соглашение подставить нельзя.
  const contractGuid = parseContractCookie(getCookie(event, CONTRACT_COOKIE))
  const pricing = resolved.status === 'ok' ? { ...resolved, contractGuid } : resolved
  const prices = (guid: string, items: string[]) => usePrices().get(guid, items, contractGuid)
  return { session, pricing, prices, store: useCatalog() }
}
