// Реквизиты поставщика («моя компания» портала) для страницы «Профиль» — только с сессией.
// Портал не ответил или моей компании нет — `null`, блок на странице не показывается.
import { supplierRoute, supplierRequisites } from '../utils/portalDirectory'

export default defineEventHandler(async (event) => {
  const r = await supplierRoute(await resolveClientSession(event), supplierRequisites)
  if (r.status === 401) throw createError({ statusCode: 401 })
  return r.body
})
