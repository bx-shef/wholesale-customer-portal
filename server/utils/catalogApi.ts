// Общая обвязка маршрутов каталога: сессия обязательна, GUID клиента — по компании из сессии.
import type { H3Event } from 'h3'
import { createCompanyGuidResolver } from './catalogView'

let resolver: ReturnType<typeof createCompanyGuidResolver> | undefined

export async function catalogContext(event: H3Event) {
  const session = await resolveClientSession(event)
  if (!session) throw createError({ statusCode: 401 })
  resolver ??= createCompanyGuidResolver(id => useAccessDirectory().getCompany(id))
  let clientGuid: string | null = null
  try {
    clientGuid = await resolver(session.companyId)
  }
  catch (e) {
    // CRM недоступна: каталог показываем без цен, а не 500.
    console.error(`[catalog] company: ${(e as Error).message}`)
  }
  const prices = (guid: string, items: string[]) => usePrices().get(guid, items)
  return { session, clientGuid, prices, store: useCatalog() }
}
