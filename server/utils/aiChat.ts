/**
 * ИИ-помощник (docs/spec.md §7): DeepSeek через AI SDK (как skills-site), стрим в B24ChatMessages.
 * Здесь — чистая часть: промпт, инструменты по каталогу клиента и разбор истории. Сам вызов
 * модели — в `server/api/ai/chat.post.ts`.
 *
 * Правила, которые держит КОД, а не промпт:
 * - цены и остатки модель видит только из ответов инструментов, а карточки на экране строятся
 *   из выхода `show_products`, который собирает сервер из каталога, — число, выдуманное моделью,
 *   на карточку не попадёт;
 * - показать модель может только товар, который ей вернул инструмент в ЭТОМ запросе;
 * - из истории браузера в модель идёт только текст: выходы инструментов прошлых ответов клиент
 *   мог подделать (подсунуть модели «цену»), поэтому они отбрасываются;
 * - в DeepSeek уходит только переписка и товары: ни имени, ни компании, ни договора.
 */
import { z } from 'zod'
import type { CatalogItemView } from '../../shared/catalogView'

export const AI_HISTORY_MAX = 20
export const AI_MESSAGE_MAX = 1000
/** Шагов «модель → инструменты» на ответ: дальше модель ходит по кругу. */
export const AI_STEPS_MAX = 5
export const AI_CARDS_MAX = 6
export const AI_SEARCH_LIMIT = 8
/** Сообщений клиента в сутки на контакт. */
export const AI_DAILY_LIMIT = 50

export interface ChatCatalog {
  search: (q: string, inStock: boolean) => Promise<CatalogItemView[]>
  details: (guid: string) => Promise<{ item: CatalogItemView & { description: string }, analogs: CatalogItemView[] } | null>
}

export const SYSTEM_PROMPT = `Ты — помощник оптового покупателя в личном кабинете поставщика стройматериалов.
Правила:
- Цены и остатки называй ТОЛЬКО из ответов инструментов. Нет в ответе — так и скажи.
- Ищи товары инструментом search_products (короткий запрос: 1–3 слова); подробности и аналоги — get_product.
- Нет нужного или нет в наличии — предложи аналоги в наличии.
- Вопросы не про ассортимент, заказы и доставку вежливо отклоняй.
- Товары, которые советуешь, ОБЯЗАТЕЛЬНО покажи инструментом show_products — клиент увидит карточки
  с ценой и кнопкой «В корзину». В тексте не дублируй карточки списком с ценами: 1–3 предложения пояснения.
- Отвечай по-русски, коротко. Можно выделять жирным; заголовки не используй.
- Заявку клиент оформляет сам в корзине; ты заявки не оформляешь.`

/** Товар для модели: только то, что нужно для ответа. */
function brief(i: CatalogItemView) {
  return { guid: i.guid, name: i.name, sku: i.sku, brand: i.brand, unit: i.unit, packQty: i.packQty, available: i.available, price: i.price ? `${i.price.value} ${i.price.currency}` : 'нет цены' }
}

export const searchInput = z.object({ query: z.string().min(1).max(100), in_stock: z.boolean().optional() })
export const productInput = z.object({ guid: z.string().min(1).max(64) })
export const showInput = z.object({ guids: z.array(z.string().max(64)).min(1).max(AI_CARDS_MAX) })

/**
 * Исполнители инструментов одного ответа. `seen` — товары, которые вернули инструменты в этом
 * запросе: только их можно показать карточкой.
 */
export function chatToolHandlers(catalog: ChatCatalog) {
  const seen = new Map<string, CatalogItemView>()
  const remember = (items: CatalogItemView[]) => items.forEach(i => seen.set(i.guid, i))
  return {
    async search({ query, in_stock }: z.infer<typeof searchInput>) {
      const items = (await catalog.search(query, in_stock === true)).slice(0, AI_SEARCH_LIMIT)
      remember(items)
      return { found: items.length, items: items.map(brief) }
    },
    async product({ guid }: z.infer<typeof productInput>) {
      const d = await catalog.details(guid)
      if (!d) return { error: 'Товар не найден' }
      remember([d.item, ...d.analogs])
      return { ...brief(d.item), description: d.item.description.slice(0, 500), analogs: d.analogs.map(brief) }
    },
    /** Выход — карточки для экрана: данные каталога, а не слова модели. */
    async show({ guids }: z.infer<typeof showInput>) {
      const items: CatalogItemView[] = []
      for (const g of guids) {
        const it = seen.get(g)
        if (it && !items.some(x => x.guid === g)) items.push(it)
      }
      return { items }
    },
  }
}

interface HistoryMessage { role: 'user' | 'assistant', parts: { type: 'text', text: string }[] }

/**
 * История из браузера → безопасная история для модели: последние сообщения, только роли
 * user/assistant и только текст (выходы инструментов отбрасываются), длина ограничена.
 * Последним должно быть сообщение клиента. Кривой ввод — `null`.
 */
export function sanitizeHistory(raw: unknown): HistoryMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: HistoryMessage[] = []
  for (const m of raw.slice(-AI_HISTORY_MAX)) {
    const role = (m as { role?: unknown })?.role
    if (role !== 'user' && role !== 'assistant') continue
    const parts = (m as { parts?: unknown }).parts
    const text = (Array.isArray(parts) ? parts : [])
      .filter((p): p is { type: 'text', text: string } => p?.type === 'text' && typeof p.text === 'string')
      .map(p => p.text).join('\n').trim()
    if (!text) continue
    if (role === 'user' && text.length > AI_MESSAGE_MAX) return null
    out.push({ role, parts: [{ type: 'text', text: text.slice(0, 4000) }] })
  }
  return out.at(-1)?.role === 'user' ? out : null
}
