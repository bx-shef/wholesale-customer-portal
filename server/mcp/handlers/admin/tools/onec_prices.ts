import { ListQuery } from '../../../../../shared/onec/schemas'

// Прайс по видам цен (GET /prices), постранично, с НДС. Цены клиента ЛК считает сам по договору.
export default defineMcpTool({
  name: 'onec_prices',
  description: 'Прайс 1С по видам цен постранично (по изменениям — changedSince)',
  inputSchema: ListQuery.partial().shape,
  handler: async params => mcpJson(() => useOnec().prices(params)),
})
