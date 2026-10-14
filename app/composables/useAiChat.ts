/**
 * Панель ИИ-помощника — общее для шапки, нижнего меню, карточки товара и самой панели.
 * `topic` — товар, который обсуждаем («Обсудить с ИИ»): сервер кладёт его карточку в контекст.
 */
export interface AiTopic { guid: string, name: string }

export function useAiChat() {
  const open = useState('ai-chat-open', () => false)
  const topic = useState<AiTopic | null>('ai-chat-topic', () => null)
  /** Вопрос, который панель отправит, как только откроется. */
  const pending = useState<string>('ai-chat-pending', () => '')
  return {
    open,
    topic,
    pending,
    toggle: () => { open.value = !open.value },
    discuss(item: AiTopic) {
      topic.value = item
      pending.value = `Расскажи про «${item.name}»: для чего подходит, на что обратить внимание и что взять вместе с ним. Есть ли аналоги в наличии?`
      open.value = true
    },
  }
}
