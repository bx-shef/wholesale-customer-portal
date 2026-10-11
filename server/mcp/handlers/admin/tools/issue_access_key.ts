import { z } from 'zod'

// Выдать или перевыпустить ключ доступа к ЛК контакту компании. Ключ — в ответе один раз;
// прежний ключ и открытые им сессии перестают действовать сразу (отпечаток ключа в сессии).
// ⚠ Ответ остаётся в журнале MCP-клиента: до вкладки компании это временный путь, и
// MCP_ADMIN_TOKEN не раздаётся агентам, чьи журналы читает кто-то кроме менеджеров.
export default defineMcpTool({
  name: 'issue_access_key',
  description: 'Выдать (перевыпустить) ключ доступа к ЛК контакту компании; ключ показывается один раз',
  inputSchema: {
    contactId: z.number().int().positive(),
    companyId: z.number().int().positive(),
    ttlDays: z.number().int().positive().max(MAX_TTL_DAYS).optional().describe('Срок действия в днях; без него — бессрочно до отзыва'),
  },
  handler: async (input) => {
    const result = await issueAccessKey(useAccessDirectory(), input)
    if (!result.ok) return { isError: true, content: [{ type: 'text' as const, text: result.error }] }
    forgetAccessCheck(result.accessId)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
})
