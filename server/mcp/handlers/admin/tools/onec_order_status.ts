import { ListQuery } from '../../../../../shared/onec/schemas'

// Статусы заказов (GET /orders/status) — источник даты отгрузки для «Мои заявки».
export default defineMcpTool({
  name: 'onec_order_status',
  description: 'Статусы заказов из 1С постранично',
  inputSchema: ListQuery.partial().shape,
  handler: async params => mcpJson(() => useOnec().orderStatus(params)),
})
