import { PricesRequest } from '../../../../../shared/onec/schemas'

// Цены по договору клиента (POST /prices), с НДС. Покупатель видит только свои — это /mcp/client.
export default defineMcpTool({
  name: 'onec_prices',
  description: 'Цены товаров по договору клиента из 1С',
  inputSchema: PricesRequest.shape,
  handler: async input => mcpJson(() => useOnec().prices(input)),
})
