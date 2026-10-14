/** Открыта ли панель ИИ-помощника — общее для шапки, нижнего меню и самой панели. */
export function useAiChat() {
  const open = useState('ai-chat-open', () => false)
  return { open, toggle: () => { open.value = !open.value } }
}
