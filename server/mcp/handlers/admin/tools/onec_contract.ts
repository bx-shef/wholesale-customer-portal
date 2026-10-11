import { z } from 'zod'

// Договор клиента (GET /client/{guid}/contract): тип цен, отсрочка, лимит, долг.
export default defineMcpTool({
  name: 'onec_contract',
  description: 'Договор клиента из 1С по GUID клиента',
  inputSchema: { clientGuid: z.string().uuid() },
  handler: async ({ clientGuid }) => mcpJson(() => useOnec().contract(clientGuid)),
})
