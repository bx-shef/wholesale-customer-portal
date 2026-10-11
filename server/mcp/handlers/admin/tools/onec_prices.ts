import { z } from 'zod'

// Цены по договору клиента (POST /prices), с НДС. Покупатель видит только свои — это /mcp/client.
export default defineMcpTool({
  name: 'onec_prices',
  description: 'Цены товаров по договору клиента из 1С',
  inputSchema: {
    clientGuid: z.string().uuid(),
    items: z.array(z.string().uuid()).min(1).max(500),
  },
  handler: async input => mcpJson(() => useOnec().prices(input)),
})
