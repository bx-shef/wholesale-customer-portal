import { portalCurrencies } from '../../utils/portalDirectory'

// Кто вошёл: компания и контакт; `currencies` — форматы валют портала для сумм на экранах. 401 — сессии нет или ключ отозван (страница уводит на /login).
export default defineEventHandler(async (event) => {
  const session = await resolveClientSession(event)
  if (!session) throw createError({ statusCode: 401 })
  const company = await useAccessDirectory().getCompany(session.companyId)
  // stockMode — можно ли заказывать сверх остатка: по нему страницы ограничивают «+» (ORDER_STOCK_MODE).
  return { currencies: await portalCurrencies(), stockMode: readServerEnv().orderStockMode, contactId: session.contactId, company: company ? { id: company.id, title: company.title } : { id: session.companyId, title: '' } }
})
