// Прайс 1С → база ЛК вручную, не дожидаясь расписания (раз в 15 минут).
export default defineMcpTool({
  name: 'sync_prices',
  description: 'Забрать изменения прайса из 1С в базу ЛК сейчас',
  inputSchema: {},
  handler: async () => mcpJson(() => syncPrices()),
})
