// Проверка связи для этапа 0: доступ к /mcp/admin настроен и токен принят.
export default defineMcpTool({
  description: 'Проверка доступа к служебному MCP ЛК',
  inputSchema: {},
  handler: async () => ({ content: [{ type: 'text', text: 'pong' }] }),
})
