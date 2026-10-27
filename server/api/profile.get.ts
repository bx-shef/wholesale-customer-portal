import { CONTRACT_COOKIE, parseContractCookie } from '../../shared/contractChoice'
import { chooseContract } from '../utils/clients'

// Профиль: компания, договор, менеджер — только для компании из сессии.
export default defineEventHandler(async (event) => {
  const session = await resolveClientSession(event)
  if (!session) throw createError({ statusCode: 401 })
  try {
    const profile = await loadProfile(session.companyId, { directory: useAccessDirectory(), call: useB24Call(), contractOf: (guid) => {
      // Договор в профиле — выбранный в корзине (#46), иначе основной: как цены и заявка.
      const c = useClientStore().get(guid)
      return c ? chooseContract(c, parseContractCookie(getCookie(event, CONTRACT_COOKIE))) : null
    }, shipmentBlockedOf: guid => useClientStore().get(guid)?.shipmentBlocked ?? false })
    // «Заказать звонок» можно выключить окружением (CALLBACK_ENABLED=false) — блок в профиле не показывается.
    return { ...profile, callbackEnabled: readServerEnv().callbackEnabled }
  }
  catch (e) {
    if ((e as { statusCode?: number }).statusCode === 404) throw createError({ statusCode: 404, message: 'Компания не найдена' })
    console.error(`[profile] ${(e as Error).message}`)
    throw createError({ statusCode: 503, message: 'Профиль временно недоступен' })
  }
})
