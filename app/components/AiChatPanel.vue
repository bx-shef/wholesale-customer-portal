<!--
  ИИ-помощник панелью справа поверх любой страницы (как в bx-shef/skills-site): приветствие с
  примерами, сообщения — B24ChatMessages, шаги поиска — B24ChatTool, ответ — markdown (MDC),
  товары — карточками из выхода show_products (данные каталога сервера, а не текст модели).
  На телефоне — на весь экран. История — в sessionStorage вкладки.
-->
<script setup lang="ts">
import type { UIMessage } from 'ai'
import { DefaultChatTransport } from 'ai'
import { Chat } from '@ai-sdk/vue'
import type { CatalogItemView } from '~~/shared/catalogView'
import { normalizeQty } from '~~/shared/cart'

const { open } = useAiChat()
const cart = useCart()
const KEY = 'wcp-ai-messages'
function readStored(): UIMessage[] {
  if (!import.meta.client) return []
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  }
  catch {
    return []
  }
}
function persist(list: UIMessage[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(list))
  }
  catch { /* приватный режим: история живёт до перезагрузки */ }
}
const examples = ['Нужна финишная шпатлёвка в наличии', 'Чем заменить Ceresit CM 115?', 'Быстросохнущая стяжка до 20 рублей']

const chat = new Chat({
  messages: readStored(),
  transport: new DefaultChatTransport({ api: '/api/ai/chat' }),
  onFinish: () => persist([...chat.messages]),
})
const messages = computed(() => chat.messages)
const busy = computed(() => chat.status === 'streaming' || chat.status === 'submitted')
const errorText = computed(() => {
  const e = chat.error
  if (!e) return ''
  try {
    return (JSON.parse(e.message) as { message?: string }).message || 'Помощник не ответил. Попробуйте ещё раз.'
  }
  catch {
    return e.message?.length < 200 ? e.message : 'Помощник не ответил. Попробуйте ещё раз.'
  }
})

const draft = ref('')
const scroller = ref<HTMLElement | null>(null)

function send(text: string) {
  const q = text.trim()
  if (!q || busy.value) return
  chat.sendMessage({ text: q })
  draft.value = ''
}
function clear() {
  chat.messages = []
  persist([])
}

type Part = UIMessage['parts'][number]
const toolState = (p: Part) => (p as { state?: string }).state
const toolInput = (p: Part) => ((p as { input?: Record<string, unknown> }).input ?? {})
const toolOutput = <T,>(p: Part) => (p as { output?: T }).output
const cardsOf = (p: Part) => toolOutput<{ items?: CatalogItemView[] }>(p)?.items ?? []
function toolText(p: Part) {
  const done = toolState(p) === 'output-available'
  if (p.type === 'tool-search_products') {
    const q = String(toolInput(p).query ?? '')
    return done ? `Нашёл по «${q}»: ${toolOutput<{ found: number }>(p)?.found ?? 0}` : `Ищу «${q}»`
  }
  return done ? 'Посмотрел карточку товара' : 'Смотрю карточку товара'
}

watch(() => messages.value.map(m => m.parts.length).join() + chat.status, () => {
  nextTick(() => { if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight })
})
</script>

<template>
  <aside
    class="ai-panel fixed inset-y-0 right-0 z-[110] flex w-full flex-col border-l border-(--ui-color-divider-default) bg-(--ui-color-bg-content-primary) md:w-(--ai-chat-width)"
    :class="{ 'is-open': open }"
    :aria-hidden="!open"
    aria-label="ИИ-помощник"
  >
    <div class="flex h-(--b24ui-header-height) shrink-0 items-center gap-1 border-b border-(--ui-color-divider-default) px-4">
      <span class="flex-1 font-semibold">ИИ-помощник</span>
      <B24Button v-if="messages.length" color="air-tertiary" size="sm" label="Очистить" @click="clear" />
      <B24Button color="air-tertiary" size="sm" label="Закрыть" @click="open = false" />
    </div>

    <div ref="scroller" class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div v-if="!messages.length" class="flex flex-col gap-2 text-sm">
        <p class="font-semibold">
          Подберу товар по вашему договору
        </p>
        <p>Спросите словами: что подобрать, чем заменить, что есть в наличии. Например:</p>
        <B24Button v-for="q in examples" :key="q" color="air-tertiary-accent" size="sm" normal-case class="self-start" :label="`«${q}»`" @click="send(q)" />
      </div>

      <B24ChatMessages
        v-else
        :messages="messages"
        :status="chat.status"
        :user="{ side: 'right', variant: 'message' }"
        :assistant="{ side: 'left', variant: 'message' }"
        class="ai-list"
      >
        <template #content="{ message }">
          <template v-for="(part, i) in message.parts" :key="`${message.id}-${i}`">
            <template v-if="part.type === 'text'">
              <MDC v-if="message.role === 'assistant'" :value="part.text" tag="div" class="ai-md text-sm" />
              <span v-else class="whitespace-pre-wrap text-sm">{{ part.text }}</span>
            </template>
            <B24ChatTool
              v-else-if="part.type === 'tool-search_products' || part.type === 'tool-get_product'"
              :text="toolText(part)"
              :streaming="toolState(part) !== 'output-available'"
              class="text-xs"
            />
            <ul v-else-if="part.type === 'tool-show_products' && cardsOf(part).length" class="my-1 flex flex-col gap-2">
              <li v-for="it in cardsOf(part)" :key="it.guid">
                <B24Card>
                  <div class="flex gap-3">
                    <img v-if="it.image" :src="it.image" alt="" loading="lazy" onerror="this.remove()" class="size-14 shrink-0 rounded object-contain bg-white">
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <NuxtLink :to="`/product/${it.guid}`" class="text-sm font-medium leading-snug" @click="open = false">
                        {{ it.name }}
                      </NuxtLink>
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-sm font-semibold">{{ it.price ? formatMoney(it.price.value, it.price.currency) : '—' }}<span class="text-xs font-normal"> / {{ it.unit }}</span></span>
                        <StockBadge :available="it.available" :unit="it.unit" />
                      </div>
                      <QtyStepper v-if="cart.qtyOf(it.guid)" :qty="cart.qtyOf(it.guid)" :pack-qty="it.packQty" :min-qty="it.minQty" :unit="it.unit" @update:qty="v => cart.setQty(it.guid, v)" />
                      <B24Button v-else size="sm" color="air-primary" class="self-start" label="В корзину" :disabled="!it.price" @click="cart.setQty(it.guid, normalizeQty(it.minQty, it.packQty, it.minQty))" />
                    </div>
                  </div>
                </B24Card>
              </li>
            </ul>
          </template>
        </template>
      </B24ChatMessages>

      <B24Alert v-if="errorText && !busy" color="air-primary-alert" :title="errorText" />
    </div>

    <div class="flex shrink-0 flex-col gap-1 border-t border-(--ui-color-divider-default) p-3">
      <B24ChatPrompt v-model="draft" placeholder="Например: клей для плитки в наличии" :maxlength="1000" @submit="send(draft)">
        <B24ChatPromptSubmit :status="chat.status" @stop="chat.stop()" @reload="chat.regenerate()" />
      </B24ChatPrompt>
      <p class="text-center text-xs text-(--ui-color-design-plain-na-content-secondary)">
        Цены и остатки — по вашему договору. ИИ может ошибаться в описаниях — проверяйте карточку товара.
      </p>
    </div>
  </aside>
</template>

<style scoped>
/* Выезд справа, как в skills-site: закрытая панель уезжает за край и не ловит фокус. */
.ai-panel { transform: translateX(100%); visibility: hidden; transition: transform .25s ease, visibility .25s ease; }
.ai-panel.is-open { transform: none; visibility: visible; }
/* Вопрос — серым пузырём справа, ответ — без пузыря, во всю ширину панели. */
.ai-list :deep(article), .ai-list :deep([data-slot="container"]), .ai-list :deep([data-slot="body"]) { min-width: 0; max-width: 100%; }
.ai-list :deep([data-role="user"] [data-slot="container"]) { max-width: 85%; margin-left: auto; }
.ai-list :deep([data-role="user"] [data-slot="content"]) {
  padding: 8px 12px; border-radius: 12px;
  background: var(--ui-color-bg-content-secondary); color: var(--ui-color-design-plain-content);
}
.ai-list :deep([data-role="assistant"] [data-slot="content"]) {
  padding: 0; background: transparent; color: inherit;
  display: flex; flex-direction: column; gap: 10px;
}
.ai-md :deep(p) { margin: 0 0 .6em; }
.ai-md :deep(p:last-child) { margin-bottom: 0; }
.ai-md :deep(ul), .ai-md :deep(ol) { margin: 0 0 .6em; padding-left: 1.2em; list-style: revert; }
.ai-md :deep(strong) { font-weight: 600; }
</style>
