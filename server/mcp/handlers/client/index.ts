// /mcp/client — инструменты покупателя и ИИ-помощника; всё ограничено компанией из сессии
// (docs/spec.md §5). Сессий клиентов пока нет (этап 2), поэтому вход закрыт для всех:
// открытый до появления сессии обработчик показал бы каталог без цены клиента кому угодно.
export default defineMcpHandler({
  description: 'MCP покупателя ЛК: поиск товаров, корзина, заявки.',
  middleware: (event) => {
    const session = resolveClientSession(event)
    if (!session) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    event.context.clientSession = session
  },
})
