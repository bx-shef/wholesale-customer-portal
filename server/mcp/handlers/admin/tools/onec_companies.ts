import { ListQuery } from '../../../../../shared/onec/schemas'

// Контрагенты 1С (GET /clients) — источник компаний для Б24 (docs/spec.md §4).
export default defineMcpTool({
  name: 'onec_companies',
  description: 'Контрагенты из 1С постранично, с фильтром по моменту изменения',
  inputSchema: ListQuery.partial().shape,
  handler: async params => mcpJson(() => useOnec().clients(params)),
})
