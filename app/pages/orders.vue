<!-- «Мои заявки»: статус и дата машины — только по компании из сессии. -->
<script setup lang="ts">
import DeliveryIcon from '@bitrix24/b24icons-vue/outline/DeliveryIcon'
import { grossPrice, lineAmounts } from '~~/shared/vat'
import { formatSlot } from '~~/shared/delivery'
import { ORDER_STEPS, orderStepIndex } from '~/utils/format'
import type { OrderTab } from '~~/shared/orderList'

useHead({ title: 'Заявки' })

interface Order {
  id: number
  createdAt: string
  status: string
  deliveryFrom: string | null
  deliveryTo: string | null
  address: string
  total: number
  currency: string
  onecNumber: string | null
  shipmentDate: string | null
  /** Доставка подтверждена в 1С — день приезда по графику (решение клиента 2026-10-27). */
  confirmedDate: string | null
  /** Рейс из задания на перевозку 1С: формируется → к погрузке → отправлено → закрыто. */
  trip: { plannedStart: string, status: 'forming' | 'loading' | 'sent' | 'closed' } | null
  items: { guid: string, name: string, sku: string, qty: number, unit: string, price: number, vatRate: number }[]
}
interface OrdersPage { items: Order[], tab: OrderTab, page: number, pageSize: number, total: number, counts: Record<OrderTab, number> }

const headers = useRequestHeaders(['cookie'])
// Вкладки «В работе» / «Выполненные» и страницы по 20 (#153): сервер отдаёт страницу и счётчики.
const tab = ref<OrderTab>('active')
const page = ref(1)
watch(tab, () => { page.value = 1 })
const { data, error } = await useFetch<OrdersPage>('/api/orders', { headers, query: { tab, page } })
const tabs = computed(() => [
  { label: `В работе (${data.value?.counts.active ?? 0})`, value: 'active' },
  { label: `Выполненные (${data.value?.counts.done ?? 0})`, value: 'done' },
])

// «Повторить» (#153): позиции заявки — в корзину к уже лежащим; цены и наличие пересчитает корзина.
const cart = useCart()
const toast = useToast()
async function repeat(o: Order) {
  const added = cart.addLines(o.items.filter(i => i.guid).map(i => ({ guid: i.guid, qty: i.qty })))
  toast.add({ title: `Добавлено ${added} ${plural(added, 'позиция', 'позиции', 'позиций')}`, color: 'air-primary-success' })
  await navigateTo('/cart')
}
if (error.value?.statusCode === 401) await navigateTo('/login')

const TRIP_STATUS = { forming: 'рейс формируется', loading: 'готовится к погрузке', sent: 'машина в пути', closed: 'рейс завершён' } as const
const tripDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Minsk', weekday: 'short', day: 'numeric', month: 'long' })

const open = ref<number | null>(null)

const date = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Minsk', day: 'numeric', month: 'long' })
</script>

<template>
  <AppPage id="orders" title="Мои заявки">
      <B24Container class="py-4 flex flex-col gap-3 max-w-2xl">
        <B24Tabs v-model="tab" :items="tabs" :content="false" />
        <B24Alert v-if="error && error.statusCode !== 401" color="air-primary-alert" title="Не удалось загрузить заявки. Обновите страницу." />
        <B24Empty
          v-else-if="!data?.items.length && tab === 'done'"
          :icon="DeliveryIcon"
          title="Выполненных заявок пока нет"
          description="Доставленные и отменённые заявки соберутся здесь."
        />
        <B24Empty
          v-else-if="!data?.items.length"
          :icon="DeliveryIcon"
          title="Заявок пока нет"
          description="Соберите корзину в каталоге и отправьте заявку — она появится здесь."
          :actions="[{ label: 'В каталог', to: '/' }]"
        />
        <B24Card v-for="o in data?.items ?? []" :key="o.id">
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <p class="font-semibold min-w-0 break-words">
                Заявка №{{ o.id }} от {{ date(o.createdAt) }}
              </p>
              <B24Badge :color="orderStatus(o.status).color" :label="orderStatus(o.status).label" />
            </div>
            <p class="text-sm">
              {{ o.items.length }} {{ plural(o.items.length, 'позиция', 'позиции', 'позиций') }} на сумму <b class="whitespace-nowrap">{{ formatMoney(o.total, o.currency) }}</b>
              <template v-if="o.onecNumber">
                · заказ {{ o.onecNumber }}
              </template>
            </p>
            <p class="text-sm">
              <template v-if="o.confirmedDate">
                <B24Badge color="air-primary-success" :label="`Точно приедет: ${date(o.confirmedDate)}`" />
              </template>
              <template v-else-if="o.trip">
                Рейс: <b>{{ tripDate(o.trip.plannedStart) }}</b> · {{ TRIP_STATUS[o.trip.status] }}
              </template>
              <template v-else-if="o.shipmentDate">
                Отгрузка: <b>{{ date(o.shipmentDate) }}</b>
              </template>
              <template v-else-if="o.deliveryFrom && o.deliveryTo">
                Машина: <b>{{ formatSlot({ arrivalFrom: o.deliveryFrom, arrivalTo: o.deliveryTo }) }}</b>
              </template>
              <template v-else>
                Дату доставки согласует менеджер
              </template>
              · {{ o.address }}
            </p>
            <div class="flex flex-wrap gap-2">
            <B24Button color="air-secondary" size="sm" label="Повторить" :aria-label="`Повторить заявку №${o.id}`" @click="repeat(o)" />
            <B24Button
              color="air-tertiary"
              size="sm"
              :label="open === o.id ? 'Скрыть состав' : 'Состав и статус'"
              @click="open = open === o.id ? null : o.id"
            />
            </div>
            <template v-if="open === o.id">
              <ol v-if="o.status !== 'cancelled' && o.status !== 'pending'" class="flex flex-wrap gap-1 text-xs" aria-label="Статус доставки">
                <li v-for="(s, i) in ORDER_STEPS" :key="s.key">
                  <B24Badge :color="i <= orderStepIndex(o.status) ? 'air-primary-success' : 'air-secondary'" :label="s.label" />
                </li>
              </ol>
              <table class="w-full text-sm tabular-nums">
                <thead>
                  <tr class="text-left text-xs text-(--ui-color-design-plain-na-content-secondary)">
                    <th class="py-1 font-normal">
                      Товар
                    </th>
                    <th class="py-1 pl-4 font-normal text-right whitespace-nowrap">
                      Кол-во
                    </th>
                    <th class="py-1 pl-4 font-normal text-right whitespace-nowrap">
                      Цена
                    </th>
                    <th class="py-1 pl-4 font-normal text-right whitespace-nowrap">
                      Сумма
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="it in o.items" :key="it.sku + it.name" class="border-t border-(--ui-color-divider-default)">
                    <td class="py-1 pr-2">
                      {{ it.name }}
                    </td>
                    <td class="py-1 pl-4 text-right whitespace-nowrap">
                      {{ it.qty }} {{ it.unit }}
                    </td>
                    <td class="py-1 pl-4 text-right whitespace-nowrap">
                      {{ formatMoney(grossPrice(it.price, it.vatRate), o.currency) }}
                    </td>
                    <td class="py-1 pl-4 text-right whitespace-nowrap">
                      {{ formatMoney(lineAmounts(it.price, it.qty, it.vatRate).total, o.currency) }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p class="text-xs text-(--ui-color-design-plain-na-content-secondary)">
                Цены с НДС по договору на момент заявки. Счёт и оплату ведёт менеджер.
              </p>
            </template>
          </div>
        </B24Card>
        <B24Pagination
          v-if="data && data.total > data.pageSize"
          v-model:page="page"
          :total="data.total"
          :items-per-page="data.pageSize"
          class="self-center"
        />
      </B24Container>
  </AppPage>
</template>
