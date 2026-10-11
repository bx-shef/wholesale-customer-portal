import { OnecError } from '../services/onec'

/**
 * Ответ MCP-инструмента: данные JSON-текстом; отказ 1С — `isError` с причиной, без данных
 * запроса. Прочие исключения пробрасываются — это наша ошибка, а не состояние 1С.
 */
export async function mcpJson(run: () => Promise<unknown>) {
  try {
    return { content: [{ type: 'text' as const, text: JSON.stringify(await run()) }] }
  }
  catch (e) {
    if (e instanceof OnecError) {
      return { isError: true, content: [{ type: 'text' as const, text: `1С: ${e.kind}${e.status ? ` ${e.status}` : ''}${e.code ? ` (${e.code})` : ''} — ${e.message}` }] }
    }
    throw e
  }
}
