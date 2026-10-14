/**
 * ИИ-помощник (docs/spec.md §7): DeepSeek с вызовом инструментов по каталогу клиента.
 * Чистое ядро: модель и инструменты приходят зависимостями — тесты гоняют цикл без сети.
 *
 * Правила, которые держит КОД, а не промпт:
 * - цены и остатки модель видит только из ответов инструментов, а карточки на экране строятся
 *   из тех же данных — число, выдуманное моделью, на карточку не попадёт;
 * - показать модель может только товар, который ей вернул инструмент в этом диалоге;
 * - в DeepSeek уходит только текст переписки и товары: ни имени, ни компании, ни договора.
 */
import { z } from 'zod'
import type { CatalogItemView } from '../../shared/catalogView'

export const AI_HISTORY_MAX = 20
export const AI_MESSAGE_MAX = 1000
/** Раундов «модель → инструменты» на один ответ: дальше модель ходит по кругу. */
export const AI_TOOL_ROUNDS_MAX = 4
export const AI_CARDS_MAX = 6
/** Сообщений клиента в сутки на контакт. */
export const AI_DAILY_LIMIT = 50

export const chatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(AI_MESSAGE_MAX),
  })).min(1).max(AI_HISTORY_MAX),
})
export type ChatRequest = z.infer<typeof chatRequestSchema>

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string, type: 'function', function: { name: string, arguments: string } }[]
  tool_call_id?: string
}

/** Один вызов модели (OpenAI-совместимый ответ, первый вариант). Сбой — исключение. */
export type Llm = (messages: LlmMessage[], tools: unknown[]) => Promise<LlmMessage>

export interface ChatTools {
  search: (q: string, inStock: boolean) => Promise<CatalogItemView[]>
  details: (guid: string) => Promise<{ item: CatalogItemView & { description: string }, analogs: CatalogItemView[] } | null>
}

export interface ChatReply { reply: string, items: CatalogItemView[] }

export const SYSTEM_PROMPT = `Ты — помощник оптового покупателя в личном кабинете поставщика стройматериалов.
Правила:
- Цены и остатки называй ТОЛЬКО из ответов инструментов. Нет в ответе — так и скажи.
- Ищи товары инструментом search_products; подробности и аналоги — get_product.
- Нет нужного или нет в наличии — предложи аналоги в наличии.
- Вопросы не про ассортимент, заказы и доставку вежливо отклоняй.
- Отвечай коротко, по-русски. Товары, о которых говоришь, покажи инструментом show_products —
  клиент увидит их карточками с кнопкой «В корзину». Не перечисляй в тексте цены всех товаров.
- Оформить заявку клиент может сам в корзине; ты заявки не оформляешь.`

export const TOOLS = [
  { type: 'function', function: { name: 'search_products', description: 'Поиск товаров каталога по словам: название, артикул, бренд.', parameters: { type: 'object', properties: { query: { type: 'string' }, in_stock: { type: 'boolean', description: 'Только в наличии' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'get_product', description: 'Карточка товара по guid: описание, цена, остаток и аналоги.', parameters: { type: 'object', properties: { guid: { type: 'string' } }, required: ['guid'] } } },
  { type: 'function', function: { name: 'show_products', description: 'Показать клиенту товары карточками. Только guid из ответов инструментов.', parameters: { type: 'object', properties: { guids: { type: 'array', items: { type: 'string' } } }, required: ['guids'] } } },
]

/** Товар для модели: только то, что нужно для ответа. */
function brief(i: CatalogItemView) {
  return { guid: i.guid, name: i.name, sku: i.sku, brand: i.brand, unit: i.unit, packQty: i.packQty, available: i.available, price: i.price ? `${i.price.value} ${i.price.currency}` : 'нет цены' }
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v as Record<string, unknown> : {}
  }
  catch {
    return {}
  }
}

export async function runChat(req: ChatRequest, llm: Llm, tools: ChatTools): Promise<ChatReply> {
  const messages: LlmMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...req.messages]
  const seen = new Map<string, CatalogItemView>()
  const shown: string[] = []
  const remember = (items: CatalogItemView[]) => items.forEach(i => seen.set(i.guid, i))

  for (let round = 0; round <= AI_TOOL_ROUNDS_MAX; round++) {
    // Последний раунд — без инструментов: модель обязана ответить текстом.
    const answer = await llm(messages, round < AI_TOOL_ROUNDS_MAX ? TOOLS : [])
    const calls = answer.tool_calls ?? []
    if (calls.length === 0) {
      return { reply: (answer.content ?? '').trim() || 'Не получилось ответить. Попробуйте переформулировать вопрос.', items: shown.map(g => seen.get(g)!) }
    }
    messages.push({ role: 'assistant', content: answer.content ?? null, tool_calls: calls })
    for (const call of calls) {
      const args = parseArgs(call.function.arguments)
      let result: unknown
      if (call.function.name === 'search_products') {
        const items = await tools.search(String(args.query ?? '').slice(0, 100), args.in_stock === true)
        remember(items)
        result = items.map(brief)
      }
      else if (call.function.name === 'get_product') {
        const d = await tools.details(String(args.guid ?? ''))
        if (d) {
          remember([d.item, ...d.analogs])
          result = { ...brief(d.item), description: d.item.description.slice(0, 500), analogs: d.analogs.map(brief) }
        }
        else {
          result = { error: 'Товар не найден' }
        }
      }
      else if (call.function.name === 'show_products') {
        const guids = Array.isArray(args.guids) ? args.guids.map(String) : []
        for (const g of guids) if (seen.has(g) && !shown.includes(g) && shown.length < AI_CARDS_MAX) shown.push(g)
        result = { shown: shown.length }
      }
      else {
        result = { error: 'Неизвестный инструмент' }
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }
  return { reply: 'Не получилось ответить. Попробуйте переформулировать вопрос.', items: shown.map(g => seen.get(g)!) }
}

/** DeepSeek по OpenAI-совместимому API. Ключ — только здесь, в лог не пишем. */
export function deepseekLlm(apiKey: string, model: string, fetchFn: typeof fetch = fetch): Llm {
  return async (messages, tools) => {
    const res = await fetchFn('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0.3, ...(tools.length ? { tools } : {}) }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`)
    const body = await res.json() as { choices?: { message?: LlmMessage }[] }
    const msg = body.choices?.[0]?.message
    if (!msg) throw new Error('DeepSeek: empty answer')
    return msg
  }
}
