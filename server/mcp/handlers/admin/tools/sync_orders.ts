// Запустить синхронизацию заявок сейчас: досылка в CRM, подтверждения → заказы 1С, статусы 1С.
export default defineMcpTool({
  name: 'sync_orders',
  description: 'Синхронизировать заявки ЛК с CRM и 1С сейчас',
  inputSchema: {},
  handler: async () => mcpJson(() => runOrderSync()),
})
