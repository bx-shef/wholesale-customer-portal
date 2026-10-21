// Запустить синхронизацию «клиенты 1С → компании Б24» сейчас, не дожидаясь расписания.
export default defineMcpTool({
  name: 'sync_companies',
  description: 'Синхронизировать клиентов 1С в компании Битрикс24 сейчас',
  inputSchema: {},
  handler: async () => mcpJson(async () => onecUnsupportedFlows().includes('clients') ? { skipped: 'not available over OData yet' } : syncCompanies()),
})
