import { ListQuery } from '../../../../../shared/onec/schemas'

// Свободные остатки по складам (GET /stock).
export default defineMcpTool({
  name: 'onec_stock',
  description: 'Свободные остатки из 1С постранично',
  inputSchema: ListQuery.partial().shape,
  handler: async params => mcpJson(() => useOnec().stock(params)),
})
