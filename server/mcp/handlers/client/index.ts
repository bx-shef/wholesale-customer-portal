// /mcp/client — инструменты покупателя и ИИ-помощника; всё ограничено компанией из сессии
// (docs/spec.md §5). Сессия — cookie ЛК или тот же токен в Authorization: Bearer.
export default defineMcpHandler({
  description: 'MCP покупателя ЛК: поиск товаров, корзина, заявки.',
  middleware: async (event) => {
    const session = await resolveClientSession(event)
    if (!session) throw createError({ statusCode: 401, message: 'Unauthorized' })
    event.context.clientSession = session
  },
})
