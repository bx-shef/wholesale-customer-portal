import { z } from 'zod'

// Журнал ИИ-помощника для разбора: последние диалоги, можно только с оценкой 👎 (rating -1) или 👍 (1).
export default defineMcpTool({
  name: 'ai_dialogs',
  description: 'Журнал диалогов ИИ-помощника: вопрос, ответ, показанные товары, оценка клиента. Фильтр rating: -1 — «не помогло», 1 — «полезно»',
  inputSchema: { rating: z.union([z.literal(1), z.literal(-1)]).optional(), limit: z.number().int().min(1).max(200).optional() },
  handler: async ({ rating, limit }) => mcpJson(() => useAiJournal().list({ rating, limit })),
})
