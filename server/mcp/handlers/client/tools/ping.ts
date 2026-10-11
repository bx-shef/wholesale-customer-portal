// Проверка связи для этапа 0.
export default defineMcpTool({
  description: 'Проверка доступа к MCP покупателя',
  inputSchema: {},
  handler: async () => ({ content: [{ type: 'text', text: 'pong' }] }),
})
