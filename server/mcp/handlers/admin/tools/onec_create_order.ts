import { z } from 'zod'

// Заказ в 1С (POST /order). Идемпотентен по externalId (ID сделки Б24): повтор вернёт тот же заказ.
// ⚠ На реальной 1С это отгрузка товара — вызывается после подтверждения менеджером (этап 4).
export default defineMcpTool({
  name: 'onec_create_order',
  description: 'Создать заказ в 1С; повтор с тем же externalId возвращает уже созданный',
  inputSchema: {
    externalId: z.string().min(1).max(64).describe('ID сделки Б24'),
    clientGuid: z.string().uuid(),
    contractGuid: z.string().uuid(),
    deliveryAddressGuid: z.string().uuid(),
    deliveryDate: z.string().date(),
    comment: z.string().max(2000).optional(),
    items: z.array(z.object({ itemGuid: z.string().uuid(), qty: z.number().positive(), price: z.number().nonnegative() })).min(1).max(500),
  },
  handler: async input => mcpJson(() => useOnec().createOrder(input)),
})
