// Реквизиты поставщика («моя компания» портала) для страницы «Профиль» — только с сессией.
// Портал не ответил или моей компании нет — `null`, блок на странице не показывается.
import { supplierRequisites } from '../utils/portalDirectory'

export default defineEventHandler(async (event) => {
  const session = await resolveClientSession(event)
  if (!session) throw createError({ statusCode: 401 })
  return { supplier: await supplierRequisites() }
})
