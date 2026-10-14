<!-- Корзина: количество с кратностью, итог по ценам договора, адрес, ближайший рейс, комментарий, «Отправить заявку». -->
<script setup lang="ts">
import CartIcon from '@bitrix24/b24icons-vue/outline/ProductIcon'
import { COMMENT_MAX } from '~~/shared/cart'
import { formatCutoff, formatSlot } from '~~/shared/delivery'

useHead({ title: 'Корзина' })

interface QuoteLine { guid: string, sku: string, name: string, unit: string, packQty: number, minQty: number, available: number, qty: number, suggestedQty: number, price: number | null, currency: string | null, total: number, problem: 'not_found' | 'no_price' | 'bad_qty' | null }
interface Quote { lines: QuoteLine[], total: number, currency: string | null, priceStatus: 'ok' | 'no-contract' | 'unavailable', ok: boolean }
interface Address { guid: string, label: string, city: string, slot: { arrivalFrom: string, arrivalTo: string, cutoffAt: string } | null, slotStatus: 'ok' | 'unavailable' }

const headers = useRequestHeaders(['cookie'])
const { error: meError } = await useFetch('/api/auth/me', { headers, key: 'me' })
if (meError.value?.statusCode === 401) await navigateTo('/login')

const cart = useCart()
const quote = ref<Quote | null>(null)
const quoteFailed = ref(false)
const { data: delivery } = await useFetch<{ addresses: Address[], status: string }>('/api/delivery', { headers })

const addressGuid = ref('')
watch(delivery, (d) => {
  if (!addressGuid.value && d?.addresses[0]) addressGuid.value = d.addresses[0].guid
}, { immediate: true })
const address = computed(() => delivery.value?.addresses.find(a => a.guid === addressGuid.value))
const addressItems = computed(() => (delivery.value?.addresses ?? []).map(a => ({ label: a.label, value: a.guid })))

let seq = 0
async function refresh() {
  const my = ++seq
  if (cart.lines.value.length === 0) {
    quote.value = null
    return
  }
  try {
    const q = await $fetch<Quote>('/api/cart/quote', { method: 'POST', body: { items: cart.lines.value } })
    if (my === seq) {
      quote.value = q
      quoteFailed.value = false
    }
  }
  catch {
    if (my === seq) quoteFailed.value = true
  }
}
onMounted(refresh)
watch(cart.lines, refresh, { deep: true })

const comment = ref('')
const sending = ref(false)
const sendError = ref('')
const sent = ref<{ orderId: number, deliveryFrom: string | null, deliveryTo: string | null } | null>(null)
// Один UUID на попытку: повтор после обрыва связи — та же заявка, а не вторая сделка.
const requestId = ref('')

const problemText: Record<NonNullable<QuoteLine['problem']>, string> = {
  not_found: 'Товара больше нет в каталоге — удалите его из корзины.',
  no_price: 'Нет цены по вашему договору — уточните у менеджера.',
  bad_qty: 'Количество должно быть кратно упаковке.',
}

async function submit() {
  if (!quote.value?.ok || !addressGuid.value) return
  requestId.value ||= crypto.randomUUID()
  sending.value = true
  sendError.value = ''
  try {
    const r = await $fetch<{ ok: true, orderId: number, deliveryFrom: string | null, deliveryTo: string | null }>('/api/orders', {
      method: 'POST',
      body: { requestId: requestId.value, items: cart.lines.value, addressGuid: addressGuid.value, comment: comment.value },
    })
    sent.value = { orderId: r.orderId, deliveryFrom: r.deliveryFrom, deliveryTo: r.deliveryTo }
    cart.clear()
    comment.value = ''
    requestId.value = ''
  }
  catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    const code = (e as { data?: { error?: string } }).data?.error
    if (status === 401) return navigateTo('/login')
    sendError.value = status === 422
      ? 'Корзина изменилась: проверьте строки с пометками и отправьте снова.'
      : code === 'in_progress'
        ? 'Заявка уже отправляется — подождите несколько секунд и обновите раздел «Заявки».'
        : code === 'already_sent'
          ? 'Эта заявка уже отправлена. Изменения уйдут новой заявкой — нажмите «Отправить» ещё раз.'
          : status === 409
            ? 'Договор ещё не подключён — обратитесь к менеджеру.'
            : status === 429
              ? 'Слишком много заявок подряд. Попробуйте через несколько минут или позвоните менеджеру.'
              : 'Не удалось отправить заявку: учётная система не ответила. Нажмите «Отправить» ещё раз — дубля не будет.'
    if (status === 422 || code === 'already_sent') {
      requestId.value = ''
      await refresh()
    }
  }
  finally {
    sending.value = false
  }
}

</script>

<template>
  <div class="pb-28 md:pb-0">
    <AppHeader title="Корзина" />
    <B24Main>
      <B24Container class="py-4 flex flex-col gap-3 max-w-2xl">
        <B24Alert v-if="sent" color="air-primary-success" :title="`Заявка №${sent.orderId} отправлена`" :description="sent.deliveryFrom && sent.deliveryTo ? `Машина приедет: ${formatSlot({ arrivalFrom: sent.deliveryFrom, arrivalTo: sent.deliveryTo })}. Менеджер подтвердит заявку, статус — в разделе «Заявки».` : 'Менеджер подтвердит заявку и согласует дату доставки. Статус — в разделе «Заявки».'" />

        <B24Empty
          v-if="cart.lines.value.length === 0"
          :icon="CartIcon"
          title="Корзина пуста"
          description="Добавьте товары из каталога."
          :actions="[{ label: 'В каталог', to: '/' }]"
        />

        <template v-else>
          <B24Alert v-if="quoteFailed" color="air-primary-alert" title="Не удалось пересчитать корзину" description="Проверьте связь и обновите страницу." />
          <B24Alert v-else-if="quote?.priceStatus === 'unavailable'" color="air-primary-warning" title="Цены временно недоступны" description="Отправить заявку можно, когда ответит учётная система. Обновите страницу через минуту." />
          <B24Alert v-else-if="quote?.priceStatus === 'no-contract'" color="air-primary-warning" title="Договор не подключён" description="Обратитесь к менеджеру — после подключения можно будет отправлять заявки." />

          <BuildLoader v-if="!quote && !quoteFailed" title="Пересчитываем корзину по вашему договору…" />

          <B24Card v-for="l in quote?.lines ?? []" :key="l.guid">
            <div class="flex flex-col gap-2">
              <div class="flex justify-between gap-2">
                <NuxtLink :to="`/product/${l.guid}`" class="font-medium leading-snug">
                  {{ l.name }}
                </NuxtLink>
                <B24Button color="air-tertiary" size="sm" label="Удалить" :aria-label="`Удалить ${l.name} из корзины`" @click="cart.setQty(l.guid, 0)" />
              </div>
              <p v-if="l.sku" class="text-xs text-(--ui-color-design-plain-na-content-secondary)">
                {{ l.sku }} · {{ l.price !== null && l.currency ? `${formatMoney(l.price, l.currency)} / ${l.unit}` : 'без цены' }}
              </p>
              <div v-if="l.problem !== 'not_found'" class="flex flex-wrap items-center justify-between gap-2">
                <QtyStepper :qty="l.qty" :pack-qty="l.packQty" :min-qty="l.minQty" :unit="l.unit" @update:qty="v => cart.setQty(l.guid, v)" />
                <span class="font-semibold">{{ l.currency ? formatMoney(l.total, l.currency) : '—' }}</span>
              </div>
              <p v-if="l.problem !== 'not_found' && l.available < l.qty" class="text-sm">
                На складах сейчас {{ formatQty(Math.max(l.available, 0), l.unit) }} — остальное менеджер согласует отдельно.
              </p>
              <B24Alert v-if="l.problem" color="air-primary-warning" :title="problemText[l.problem]">
                <template v-if="l.problem === 'bad_qty'" #actions>
                  <B24Button size="sm" color="air-secondary" :label="`Взять ${formatQty(l.suggestedQty, l.unit)}`" @click="cart.setQty(l.guid, l.suggestedQty)" />
                </template>
              </B24Alert>
            </div>
          </B24Card>

          <B24Card>
            <div class="flex flex-col gap-3">
              <B24FormField label="Адрес доставки">
                <B24Select v-if="addressItems.length" v-model="addressGuid" :items="addressItems" class="w-full" />
                <p v-else class="text-sm">
                  Адрес доставки не найден в учётной системе — обратитесь к менеджеру.
                </p>
              </B24FormField>
              <p v-if="address" class="text-sm">
                <template v-if="address.slot">
                  Машина приедет: <b>{{ formatSlot(address.slot) }}</b>, если заявка будет подтверждена до {{ formatCutoff(address.slot.cutoffAt) }}.
                </template>
                <template v-else-if="address.slotStatus === 'unavailable'">
                  Расписание рейсов сейчас недоступно — дату доставки согласует менеджер.
                </template>
                <template v-else>
                  Рейсов в {{ address.city }} пока нет в расписании — дату согласует менеджер.
                </template>
              </p>
              <B24FormField label="Комментарий" :hint="`${comment.length} / ${COMMENT_MAX}`">
                <B24Textarea v-model="comment" :maxlength="COMMENT_MAX" :rows="3" placeholder="Например: разгрузка с 9:00, позвонить заранее" class="w-full" />
              </B24FormField>
            </div>
          </B24Card>
        </template>
        <div v-if="cart.lines.value.length" class="fixed inset-x-0 bottom-0 z-10 border-t border-(--ui-color-divider-default) bg-(--ui-color-bg-content-primary) p-3 md:static md:border-0 md:bg-transparent md:p-0">
          <BuildLoader v-if="sending" compact title="Передаём заявку менеджеру…" />
          <B24Alert v-if="sendError" color="air-primary-alert" :title="sendError" class="mb-2" />
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-xs text-(--ui-color-design-plain-na-content-secondary)">
                Итого с НДС
              </p>
              <p class="text-lg font-semibold">
                {{ quote?.currency ? formatMoney(quote.total, quote.currency) : '—' }}
              </p>
            </div>
            <B24Button color="air-primary" label="Отправить заявку" class="min-h-11" :loading="sending" :disabled="!quote?.ok || !addressGuid" @click="submit" />
          </div>
        </div>
      </B24Container>
    </B24Main>
  </div>
</template>
