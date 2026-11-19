// Кто вошёл: компания и контакт. 401 — сессии нет или ключ отозван (страница уводит на /login).
// stockMode — можно ли заказывать сверх остатка (ORDER_STOCK_MODE); currencies — форматы валют портала
// из кэша без ожидания портала (пусто — суммы запасным видом).
import { meRoute, portalCurrencies } from '../../utils/portalDirectory'

export default defineEventHandler(async (event) => {
  const r = await meRoute(await resolveClientSession(event), {
    company: id => useAccessDirectory().getCompany(id),
    stockMode: readServerEnv().orderStockMode,
    currencies: portalCurrencies.peek,
  })
  if (r.status === 401) throw createError({ statusCode: 401 })
  return r.body
})
