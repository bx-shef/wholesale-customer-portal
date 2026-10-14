// ИИ-помощник: DeepSeek через AI SDK, стрим в B24ChatMessages; инструменты — каталог с ценами
// договора клиента. Только с сессией. Правила безопасности — server/utils/aiChat.ts.
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { convertToModelMessages, stepCountIs, streamText, tool } from 'ai'
import { lastQuestion, topicPrompt, AI_DAILY_LIMIT, AI_SEARCH_LIMIT, AI_STEPS_MAX, chatToolHandlers, productInput, sanitizeHistory, searchInput, showInput, SYSTEM_PROMPT } from '../../utils/aiChat'
import { createRateLimiter } from '../../utils/rateLimit'

const daily = createRateLimiter(AI_DAILY_LIMIT, 24 * 60 * 60_000)

export default defineEventHandler(async (event) => {
  const ctx = await catalogContext(event)
  const env = readServerEnv()
  if (!env.deepseekApiKey) throw createError({ statusCode: 503, message: 'Помощник не настроен на сервере' })
  const body = await readBody(event)
  const history = sanitizeHistory(body?.messages)
  if (!history) throw createError({ statusCode: 400, message: 'Слишком длинный вопрос' })
  const contact = String(ctx.session.contactId)
  if (!daily.take(contact)) throw createError({ statusCode: 429, message: `Лимит — ${AI_DAILY_LIMIT} вопросов в сутки. Продолжим завтра.` })

  const h = chatToolHandlers({
    search: async (q, inStock) => (await catalogPage(ctx.store, { q, inStock, limit: AI_SEARCH_LIMIT }, ctx.pricing, ctx.prices)).items,
    details: async (guid) => {
      const d = await catalogItem(ctx.store, guid, ctx.pricing, ctx.prices)
      if (!d) return null
      const { analogs, ...item } = d.item
      return { item, analogs: analogs.slice(0, 5) }
    },
  })
  const topic = typeof body?.product === 'string' ? body.product.slice(0, 64) : null
  const journal = useAiJournal()
  const dialogId = journal.start({ companyId: ctx.session.companyId, contactId: ctx.session.contactId, question: lastQuestion(history), topic })
  const deepseek = createOpenAICompatible({ name: 'deepseek', baseURL: 'https://api.deepseek.com/v1', apiKey: env.deepseekApiKey })
  const result = streamText({
    model: deepseek(env.deepseekModel),
    system: SYSTEM_PROMPT + await topicPrompt(body?.product, h),
    messages: await convertToModelMessages(history),
    temperature: 0.3,
    stopWhen: stepCountIs(AI_STEPS_MAX),
    tools: {
      search_products: tool({ description: 'Поиск товаров каталога: название, артикул, бренд. Возвращает цену и остаток клиента.', inputSchema: searchInput, execute: h.search }),
      get_product: tool({ description: 'Карточка товара по guid: описание, цена, остаток, аналоги.', inputSchema: productInput, execute: h.product }),
      show_products: tool({ description: 'Показать клиенту товары карточками с кнопкой «В корзину». Только guid из ответов инструментов.', inputSchema: showInput, execute: h.show }),
    },
    onFinish: ({ steps }) => journal.finish(dialogId, { answer: steps.map(s => s.text).filter(Boolean).join('\n\n'), products: h.shown(), ok: true }),
    onError: ({ error }) => {
      console.error(`[ai] ${(error as Error)?.message ?? 'stream error'}`)
      journal.finish(dialogId, { answer: '', products: h.shown(), ok: false })
    },
  })
  return result.toUIMessageStreamResponse({
    // Номер записи журнала — клиенту: по нему ставится оценка 👍/👎.
    messageMetadata: ({ part }) => (part.type === 'start' ? { dialogId } : undefined),
    // Наружу — без подробностей: в тексте ошибки провайдера бывают адреса и параметры запроса.
    onError: () => 'Помощник сейчас не отвечает. Попробуйте через минуту.',
  })
})
