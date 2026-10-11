import { z } from 'zod'

// Контрагенты 1С (GET /clients) — источник компаний для Б24 (docs/spec.md §4).
export default defineMcpTool({
  name: 'onec_companies',
  description: 'Контрагенты из 1С постранично, с фильтром по моменту изменения',
  inputSchema: {
    changedSince: z.string().datetime({ offset: true }).optional().describe('Только изменённое позже этого момента (ISO 8601)'),
    page: z.number().int().positive().optional().describe('Номер страницы, с 1'),
    pageSize: z.number().int().positive().max(500).optional(),
  },
  handler: async params => mcpJson(() => useOnec().clients(params)),
})
