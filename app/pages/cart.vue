<!-- Корзина: количество с кратностью, итог по ценам договора, адрес, ближайший рейс, комментарий, «Отправить заявку». -->
<script setup lang="ts">
import CartIcon from '@bitrix24/b24icons-vue/outline/ProductIcon'
import { COMMENT_MAX, maxOrderQty } from '~~/shared/cart'
import type { ClientDataResponse } from '~~/shared/clientData'
import { formatCutoff, formatSlot } from '~~/shared/delivery'

/** Как `NEW_ADDRESS_MAX` на сервере (server/utils/orders.ts). */
const NEW_ADDRESS_MAX = 300

// Длинное соглашение или адрес не вылезает за край: переносится, как и пункты списка (владелец 2026-10-27).
const WRAP_SELECT = { base: 'h-auto min-h-9 py-1.5 pe-9 whitespace-normal', value: 'whitespace-normal break-words text-start', viewport: 'w-[min(32rem,calc(100vw-2rem))]', item: 'h-auto min-h-9 py-1.5 whitespace-normal', itemLabel: 'whitespace-normal break-words' }
useHead({ title: 'Корзина' })
const stockMode = useStockMode()

interface QuoteLine { guid: string, sku: string, name: string, unit: string, packQty: number, minQty: number, available: number, qty: number, suggestedQty: number, price: number | null, currency: string | null, total: number, problem: 'not_found' | 'no_price' | 'bad_qty' | 'out_of_stock' | 'over_stock' | null }
interface Quote { lines: QuoteLine[], total: number, currency: string | null, priceStatus: 'ok' | 'no-contract' | 'unavailable', ok: boolean }
interface Address { guid: string, label: string, city: string, slot: { arrivalFrom: string, arrivalTo: string, cutoffAt: string } | null, slotStatus: 'ok' | 'unavailable' }

const headers = useRequestHeaders(['cookie'])
const { error: meError } = await useFetch('/api/auth/me', { headers, key: 'me' })
if (meError.value?.statusCode === 401) await navigateTo('/login')

const cart = useCart()
const quote = ref<Quote | null>(null)
const quoteFailed = ref(false)
const { data: delivery } = await useFetch<{ addresses: Address[], status: string, shipmentBlocked?: boolean }>('/api/delivery', { headers })

const addressGuid = ref('')
watch(delivery, (d) => {
  if (!addressGuid.value && d?.addresses[0]) addressGuid.value = d.addresses[0].guid
}, { immediate: true })
// Новый адрес (#124): клиент набирает его в том же поле — «Доставить по адресу: …». В 1С его нет,
// менеджер внесёт его сам; дату доставки для него согласует менеджер.
const NEW = '__new'
const newAddress = ref('')
const address = computed(() => delivery.value?.addresses.find(a => a.guid === addressGuid.value))
const addressItems = computed(() => [
  ...(delivery.value?.addresses ?? []).map(a => ({ label: a.label, value: a.guid })),
  ...(newAddress.value ? [{ label: `Новый адрес: ${newAddress.value}`, value: NEW }] : []),
])
const addressError = ref('')
function createAddress(text: string) {
  const s = text.replace(/\s+/g, ' ').trim()
  if (s.length < 5 || s.length > NEW_ADDRESS_MAX) {
    addressError.value = `Укажите адрес полностью: город, улица, дом (до ${NEW_ADDRESS_MAX} знаков).`
    return
  }
  addressError.value = ''
  newAddress.value = s
  addressGuid.value = NEW
}
const isNewAddress = computed(() => addressGuid.value === NEW && !!newAddress.value)

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

// Соглашение заявки (#46): у клиента их может быть несколько, цены — по выбранному.
const clientData = useState<ClientDataResponse | null>('client-data', () => null)
const contractItems = computed(() => (clientData.value?.contracts ?? []).map(c => ({ label: c.label, value: c.guid })))
const contractGuid = ref(clientData.value?.selected ?? '')
watch(() => clientData.value?.selected, (v) => { if (v && !contractGuid.value) contractGuid.value = v })
const contractError = ref('')
async function chooseContract(guid: string) {
  if (!guid || guid === clientData.value?.selected) return
  contractError.value = ''
  try {
    const r = await $fetch<{ selected: string | null }>('/api/contract', { method: 'POST', body: { guid } })
    if (clientData.value) clientData.value = { ...clientData.value, selected: r.selected }
    // Сохранённый без сети каталог — с ценами прежнего соглашения: стираем и привязываем заново.
    const companyId = useNuxtData<{ company: { id: number } }>('me').data.value?.company.id
    await clearCatalogCache()
    if (companyId) setCacheCompany(companyId)
    await refresh()
  }
  catch {
    contractError.value = 'Не удалось сменить соглашение. Повторите.'
    contractGuid.value = clientData.value?.selected ?? ''
  }
}
watch(contractGuid, chooseContract)

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
  out_of_stock: 'Нет в наличии — удалите товар из корзины.',
  over_stock: 'Больше, чем есть в наличии.',
}

async function submit() {
  if (!quote.value?.ok || !addressGuid.value) return
  requestId.value ||= crypto.randomUUID()
  sending.value = true
  sendError.value = ''
  try {
    const r = await $fetch<{ ok: true, orderId: number, deliveryFrom: string | null, deliveryTo: string | null }>('/api/orders', {
      method: 'POST',
      body: { requestId: requestId.value, items: cart.lines.value, ...(isNewAddress.value ? { addressGuid: '', newAddress: newAddress.value } : { addressGuid: addressGuid.value }), comment: comment.value },
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
      : code === 'bad_address'
        ? 'Проверьте адрес доставки: выберите из списка или наберите новый полностью.'
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
  <AppPage id="cart" title="Корзина" :bottom-bar="cart.lines.value.length > 0">
      <B24Container class="pt-4 pb-4 flex flex-col gap-3 max-w-2xl">
        <B24Alert v-if="sent" color="air-primary-success" :title="`Заявка №${sent.orderId} отправлена`" :description="sent.deliveryFrom && sent.deliveryTo ? `Машина приедет: ${formatSlot({ arrivalFrom: sent.deliveryFrom, arrivalTo: sent.deliveryTo })}. Менеджер подтвердит заявку, статус — в разделе «Заявки».` : 'Менеджер подтвердит заявку и согласует дату доставки. Статус — в разделе «Заявки».'" />

        <!-- Пока корзина не прочитана с устройства, «пусто» не показываем: иначе оно мелькает (#77). -->
        <BuildLoader v-if="!cart.loaded.value" compact title="Открываем корзину…" />
        <B24Empty
          v-else-if="cart.lines.value.length === 0"
          :icon="CartIcon"
          title="Корзина пуста"
          description="Добавьте товары из каталога."
          :actions="[{ label: 'В каталог', to: '/' }]"
        />

        <template v-else>
          <B24Alert v-if="delivery?.shipmentBlocked" color="air-primary-warning" title="Отгрузка приостановлена" description="Заявки принимаем, но отгрузку сейчас подтверждает менеджер — обычно это вопрос оплаты. Свяжитесь с вашим менеджером." class="mb-2" />
          <B24Alert v-if="quoteFailed" color="air-primary-alert" title="Не удалось пересчитать корзину" description="Проверьте связь и обновите страницу." />
          <B24Alert v-else-if="quote?.priceStatus === 'unavailable'" color="air-primary-warning" title="Цены временно недоступны" description="Отправить заявку можно, когда ответит учётная система. Обновите страницу через минуту." />
          <B24Alert v-else-if="quote?.priceStatus === 'no-contract'" color="air-primary-warning" title="Договор не подключён" description="Обратитесь к менеджеру — после подключения можно будет отправлять заявки." />

          <BuildLoader v-if="!quote && !quoteFailed" title="Пересчитываем корзину по вашему договору…" />

          <B24Card v-for="l in quote?.lines ?? []" :key="l.guid">
            <div class="flex flex-col gap-2">
              <div class="flex justify-between gap-2">
                <NuxtLink :to="`/product/${l.guid}`" class="font-medium leading-snug min-w-0 break-words">
                  {{ l.name }}
                </NuxtLink>
                <B24Button color="air-tertiary" size="sm" label="Удалить" :aria-label="`Удалить ${l.name} из корзины`" @click="cart.setQty(l.guid, 0)" />
              </div>
              <p v-if="l.sku" class="text-xs text-(--ui-color-design-plain-na-content-secondary)">
                {{ l.sku }} · {{ l.price !== null && l.currency ? `${formatMoney(l.price, l.currency)} / ${l.unit}` : 'без цены' }}
              </p>
              <div v-if="l.problem !== 'not_found'" class="flex flex-wrap items-center justify-between gap-2">
                <QtyStepper :qty="l.qty" :pack-qty="l.packQty" :min-qty="l.minQty" :unit="l.unit" :max="maxOrderQty(l.available, l.packQty, l.minQty, stockMode)" @update:qty="v => cart.setQty(l.guid, v)" />
                <span class="font-semibold">{{ l.currency ? formatMoney(l.total, l.currency) : '—' }}</span>
              </div>
              <p v-if="stockMode !== 'stock' && l.problem !== 'not_found' && l.available < l.qty" class="text-sm">
                На складах сейчас {{ formatQty(Math.max(l.available, 0), l.unit) }} — остальное менеджер согласует отдельно.
              </p>
              <B24Alert v-if="l.problem" color="air-primary-warning" :title="problemText[l.problem]">
                <template v-if="(l.problem === 'bad_qty' || l.problem === 'over_stock') && l.suggestedQty > 0" #actions>
                  <B24Button size="sm" color="air-secondary" :label="`Взять ${formatQty(l.suggestedQty, l.unit)}`" @click="cart.setQty(l.guid, l.suggestedQty)" />
                </template>
              </B24Alert>
            </div>
          </B24Card>

          <B24Card>
            <div class="flex flex-col gap-3">
              <B24FormField v-if="contractItems.length > 1" label="Соглашение" description="Цены и заявка — по выбранному соглашению.">
                <B24Select v-model="contractGuid" :items="contractItems" class="w-full min-w-0 max-w-full" :b24ui="WRAP_SELECT" />
              </B24FormField>
              <B24Alert v-if="contractError" color="air-primary-alert" :title="contractError" />
              <B24FormField label="Адрес доставки" description="Выберите адрес или наберите новый и нажмите на него в списке.">
                <B24SelectMenu
                  v-model="addressGuid"
                  :items="addressItems"
                  value-key="value"
                  create-item="always"
                  :search-input="{ placeholder: 'Найти или ввести новый адрес…' }"
                  placeholder="Выберите адрес доставки"
                  class="w-full min-w-0 max-w-full"
                  :b24ui="WRAP_SELECT"
                  @create="createAddress"
                />
              </B24FormField>
              <B24Alert v-if="addressError" color="air-primary-warning" :title="addressError" />
              <p v-if="isNewAddress" class="text-sm">
                Доставим по новому адресу. Менеджер внесёт его в учётную систему и согласует дату доставки.
              </p>
              <p v-else-if="address" class="text-sm">
                <template v-if="address.slot">
                  Машина приедет: <b>{{ formatSlot(address.slot) }}</b>, если заявка будет подтверждена до {{ formatCutoff(address.slot.cutoffAt) }}.
                </template>
                <template v-else-if="address.slotStatus === 'unavailable'">
                  Расписание рейсов сейчас недоступно — дату доставки согласует менеджер.
                </template>
                <template v-else>
                  Дату доставки согласует менеджер.
                </template>
              </p>
              <B24FormField label="Комментарий" :hint="`${comment.length} / ${COMMENT_MAX}`">
                <B24Textarea v-model="comment" :maxlength="COMMENT_MAX" :rows="3" placeholder="Например: разгрузка с 9:00, позвонить заранее" class="w-full" />
              </B24FormField>
              <p class="text-xs text-(--ui-color-design-plain-na-content-secondary)">
                Цены и наличие — по последнему обмену с 1С. Менеджер подтвердит заказ и сообщит, если что-то изменилось.
              </p>
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
  </AppPage>
</template>
