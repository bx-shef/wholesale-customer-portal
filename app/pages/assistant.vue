<!--
  ИИ-помощник (docs/spec.md §7): вопрос словами — ответ и товары карточками с «В корзину».
  Цены на карточках — из каталога сервера, а не из текста модели. Переписка живёт до перезагрузки.
-->
<script setup lang="ts">
import type { CatalogItemView } from '~~/shared/catalogView'
import { normalizeQty } from '~~/shared/cart'

useHead({ title: 'Помощник' })

interface Msg { role: 'user' | 'assistant', content: string, items?: CatalogItemView[] }

const cart = useCart()
const messages = useState<Msg[]>('ai-chat', () => [])
const text = ref('')
const busy = ref(false)
const error = ref('')
const examples = ['Нужна финишная шпатлёвка, что есть в наличии?', 'Чем заменить Ceresit CM 115?', 'Быстросохнущая стяжка до 20 рублей']

async function send(q = text.value) {
  const content = q.trim()
  if (!content || busy.value) return
  error.value = ''
  messages.value = [...messages.value, { role: 'user', content }]
  text.value = ''
  busy.value = true
  try {
    const history = messages.value.slice(-20).map(m => ({ role: m.role, content: m.content.slice(0, 1000) }))
    const r = await $fetch<{ reply: string, items: CatalogItemView[] }>('/api/ai/chat', { method: 'POST', body: { messages: history } })
    messages.value = [...messages.value, { role: 'assistant', content: r.reply, items: r.items }]
  }
  catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status === 401) return navigateTo('/login')
    error.value = (e as { data?: { message?: string } }).data?.message || 'Помощник не ответил. Попробуйте ещё раз.'
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="pb-16 md:pb-0">
    <AppHeader title="Помощник" />
    <B24Main>
      <B24Container class="py-4 flex flex-col gap-3 max-w-2xl">
        <B24Card v-if="!messages.length">
          <div class="flex flex-col gap-2">
            <p class="text-sm">
              Спросите словами: что подобрать, чем заменить, что есть в наличии. Цены — по вашему договору.
            </p>
            <div class="flex flex-wrap gap-2">
              <B24Button v-for="ex in examples" :key="ex" size="sm" color="air-secondary" :label="ex" @click="send(ex)" />
            </div>
          </div>
        </B24Card>

        <template v-for="(m, i) in messages" :key="i">
          <div :class="m.role === 'user' ? 'self-end max-w-[85%]' : 'self-start w-full'">
            <B24Card :variant="m.role === 'user' ? 'filled' : undefined">
              <p class="text-sm whitespace-pre-line">
                {{ m.content }}
              </p>
            </B24Card>
            <ul v-if="m.items?.length" class="mt-2 grid gap-2 sm:grid-cols-2">
              <li v-for="it in m.items" :key="it.guid">
                <B24Card class="h-full">
                  <div class="flex gap-3">
                    <img v-if="it.image" :src="it.image" alt="" onerror="this.remove()" loading="lazy" class="size-14 shrink-0 rounded object-contain bg-white">
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <NuxtLink :to="`/product/${it.guid}`" class="text-sm font-medium leading-snug">
                        {{ it.name }}
                      </NuxtLink>
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-sm font-semibold">{{ it.price ? formatMoney(it.price.value, it.price.currency) : '—' }}</span>
                        <StockBadge :available="it.available" :unit="it.unit" />
                      </div>
                      <QtyStepper v-if="cart.qtyOf(it.guid)" :qty="cart.qtyOf(it.guid)" :pack-qty="it.packQty" :min-qty="it.minQty" :unit="it.unit" @update:qty="v => cart.setQty(it.guid, v)" />
                      <B24Button v-else size="sm" color="air-primary" label="В корзину" :disabled="!it.price" @click="cart.setQty(it.guid, normalizeQty(it.minQty, it.packQty, it.minQty))" />
                    </div>
                  </div>
                </B24Card>
              </li>
            </ul>
          </div>
        </template>

        <B24Skeleton v-if="busy" class="h-12 w-full" />
        <B24Alert v-if="error" color="air-primary-alert" :title="error" />

        <form class="flex gap-2 sticky bottom-16 md:bottom-2" @submit.prevent="send()">
          <B24Input v-model="text" placeholder="Например: клей для плитки в наличии" maxlength="1000" class="flex-1" :disabled="busy" />
          <B24Button type="submit" color="air-primary" label="Спросить" :loading="busy" />
        </form>
      </B24Container>
    </B24Main>
  </div>
</template>
