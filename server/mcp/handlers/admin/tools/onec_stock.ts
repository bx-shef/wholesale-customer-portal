import { z } from 'zod'

// Свободные остатки по складам (GET /stock).
export default defineMcpTool({
  name: 'onec_stock',
  description: 'Свободные остатки из 1С постранично',
  inputSchema: {
    changedSince: z.string().datetime({ offset: true }).optional().describe('Только изменённое позже этого момента (ISO 8601)'),
    page: z.number().int().positive().optional().describe('Номер страницы, с 1'),
    pageSize: z.number().int().positive().max(500).optional(),
  },
  handler: async params => mcpJson(() => useOnec().stock(params)),
})
