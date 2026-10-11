import { ListQuery } from '../../../../../shared/onec/schemas'

// Каталог 1С (GET /catalog): разделы на первой странице, товары постранично.
export default defineMcpTool({
  name: 'onec_catalog',
  description: 'Каталог товаров из 1С постранично',
  inputSchema: ListQuery.partial().shape,
  handler: async params => mcpJson(() => useOnec().catalog(params)),
})
