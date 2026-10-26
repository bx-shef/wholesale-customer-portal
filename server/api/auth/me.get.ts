// Кто вошёл: компания и контакт. 401 — сессии нет или ключ отозван (страница уводит на /login).
export default defineEventHandler(async (event) => {
  const session = await resolveClientSession(event)
  if (!session) throw createError({ statusCode: 401 })
  const company = await useAccessDirectory().getCompany(session.companyId)
  const env = readServerEnv()
  return { ai: env.aiAssistant && !!env.deepseekApiKey, contactId: session.contactId, company: company ? { id: company.id, title: company.title } : { id: session.companyId, title: '' } }
})
