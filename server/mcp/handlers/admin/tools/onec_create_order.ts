import { OrderRequest } from '../../../../../shared/onec/schemas'

// Заказ в 1С (POST /order). Идемпотентен по externalId (ID сделки Б24): повтор вернёт тот же заказ.
// Схема — из контракта (shared/onec/schemas.ts), а не копия: копия уже расходилась с ним.
// ⚠ На реальной 1С это отгрузка товара — вызывается после подтверждения менеджером (этап 4).
export default defineMcpTool({
  name: 'onec_create_order',
  description: 'Создать заказ в 1С; повтор с тем же externalId возвращает уже созданный',
  inputSchema: OrderRequest.shape,
  handler: async input => mcpJson(() => useOnec().createOrder(input)),
})
