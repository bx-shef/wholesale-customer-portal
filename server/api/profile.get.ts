// Профиль: компания, договор, менеджер — только для компании из сессии.
export default defineEventHandler(async (event) => {
  const session = await resolveClientSession(event)
  if (!session) throw createError({ statusCode: 401 })
  return loadProfile(session.companyId, { directory: useAccessDirectory(), call: useB24Call(), onec: useOnec })
})
