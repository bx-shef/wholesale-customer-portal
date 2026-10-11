import { z } from 'zod'

// Отозвать доступ контакта к ЛК компании: новые входы и уже открытые сессии закрываются сразу.
export default defineMcpTool({
  name: 'revoke_access_key',
  description: 'Отозвать ключ доступа к ЛК у контакта компании',
  inputSchema: {
    contactId: z.number().int().positive(),
    companyId: z.number().int().positive(),
  },
  handler: async ({ contactId, companyId }) => {
    const revoked = await useAccessDirectory().revokeAccess(contactId, companyId)
    forgetAccessCheck()
    return { content: [{ type: 'text' as const, text: JSON.stringify({ revoked }) }] }
  },
})
