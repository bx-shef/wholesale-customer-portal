// /mcp/admin — обмены onec_* и b24_*, выдача ключей (docs/spec.md §5).
// Вызывают планировщик, вкладка компании и внутренние агенты с Bearer MCP_ADMIN_TOKEN.
export default defineMcpHandler({
  description: 'Служебный MCP ЛК: обмены с 1С и Битрикс24, ключи доступа.',
  middleware: (event) => {
    const token = parseBearer(getRequestHeader(event, 'authorization'))
    if (!bearerMatches(token, readServerEnv().mcpAdminToken)) {
      throw createError({ statusCode: 401, message: 'Unauthorized' })
    }
  },
})
