// Профиль: компания, договор, менеджер — только для компании из сессии.
export default defineEventHandler(async (event) => {
  const session = await resolveClientSession(event)
  if (!session) throw createError({ statusCode: 401 })
  try {
    return await loadProfile(session.companyId, { directory: useAccessDirectory(), call: useB24Call(), contractOf: guid => useClientStore().get(guid)?.contract ?? null })
  }
  catch (e) {
    if ((e as { statusCode?: number }).statusCode === 404) throw createError({ statusCode: 404, message: 'Компания не найдена' })
    console.error(`[profile] ${(e as Error).message}`)
    throw createError({ statusCode: 503, message: 'Профиль временно недоступен' })
  }
})
