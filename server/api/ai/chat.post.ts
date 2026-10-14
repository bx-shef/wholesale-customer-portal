// ИИ-помощник: DeepSeek + поиск по каталогу с ценами договора клиента. Только с сессией.
import { AI_DAILY_LIMIT, chatRequestSchema, deepseekLlm, runChat } from '../../utils/aiChat'
import { createRateLimiter } from '../../utils/rateLimit'

const daily = createRateLimiter(AI_DAILY_LIMIT, 24 * 60 * 60_000)

export default defineEventHandler(async (event) => {
  const ctx = await catalogContext(event)
  const env = readServerEnv()
  if (!env.deepseekApiKey) throw createError({ statusCode: 503, message: 'Помощник не настроен на сервере' })
  const parsed = chatRequestSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Слишком длинный вопрос или переписка' })
  if (!daily.take(String(ctx.session.contactId))) throw createError({ statusCode: 429, message: `Лимит — ${AI_DAILY_LIMIT} вопросов в сутки. Продолжим завтра.` })
  try {
    return await runChat(parsed.data, deepseekLlm(env.deepseekApiKey, env.deepseekModel), {
      search: async (q, inStock) => (await catalogPage(ctx.store, { q, inStock, limit: 8 }, ctx.pricing, ctx.prices)).items,
      details: async (guid) => {
        const d = await catalogItem(ctx.store, guid, ctx.pricing, ctx.prices)
        if (!d) return null
        const { analogs, ...item } = d.item
        return { item, analogs: analogs.slice(0, 5) }
      },
    })
  }
  catch (e) {
    daily.release(String(ctx.session.contactId))
    console.error(`[ai] ${(e as Error).message}`)
    throw createError({ statusCode: 503, message: 'Помощник сейчас не отвечает. Попробуйте через минуту.' })
  }
})
