import { z } from 'zod'

// Каталог 1С (GET /catalog): разделы на первой странице, товары постранично.
export default defineMcpTool({
  name: 'onec_catalog',
  description: 'Каталог товаров из 1С постранично',
  inputSchema: {
    changedSince: z.string().datetime({ offset: true }).optional().describe('Только изменённое позже этого момента (ISO 8601)'),
    page: z.number().int().positive().optional().describe('Номер страницы, с 1'),
    pageSize: z.number().int().positive().max(500).optional(),
  },
  handler: async params => mcpJson(() => useOnec().catalog(params)),
})
