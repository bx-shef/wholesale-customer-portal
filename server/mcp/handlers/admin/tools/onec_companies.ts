import { ListQuery } from '../../../../../shared/onec/schemas'

// Контрагенты 1С (GET /clients) — для разбора. Компании в Б24 заводит штатный обмен 1С, не ЛК.
export default defineMcpTool({
  name: 'onec_companies',
  description: 'Контрагенты из 1С постранично, с фильтром по моменту изменения',
  inputSchema: ListQuery.partial().shape,
  handler: async params => mcpJson(() => useOnec().clients(params)),
})
