import { z } from 'zod'

// Статусы заказов (GET /orders/status) — источник даты отгрузки для «Мои заявки».
export default defineMcpTool({
  name: 'onec_order_status',
  description: 'Статусы заказов из 1С постранично',
  inputSchema: {
    changedSince: z.string().datetime({ offset: true }).optional().describe('Только изменённое позже этого момента (ISO 8601)'),
    page: z.number().int().positive().optional().describe('Номер страницы, с 1'),
    pageSize: z.number().int().positive().max(500).optional(),
  },
  handler: async params => mcpJson(() => useOnec().orderStatus(params)),
})
