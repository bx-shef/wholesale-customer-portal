<!-- «Мои заявки»: статус и дата машины — только по компании из сессии. -->
<script setup lang="ts">
import DeliveryIcon from '@bitrix24/b24icons-vue/outline/DeliveryIcon'
import { lineTotal } from '~~/shared/cart'
import { formatSlot } from '~~/shared/delivery'

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
  /** Рейс из задания на перевозку 1С: формируется → к погрузке → отправлено → закрыто. */
  trip: { plannedStart: string, status: 'forming' | 'loading' | 'sent' | 'closed' } | null
  items: { name: string, sku: string, qty: number, unit: string, price: number, vatRate: number }[]
}

const headers = useRequestHeaders(['cookie'])
const { data, error } = await useFetch<{ items: Order[] }>('/api/orders', { headers })
if (error.value?.statusCode === 401) await navigateTo('/login')

const TRIP_STATUS = { forming: 'рейс формируется', loading: 'готовится к погрузке', sent: 'машина в пути', closed: 'рейс завершён' } as const
const tripDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Minsk', weekday: 'short', day: 'numeric', month: 'long' })

/** Путь заявки: где она сейчас — от «Новая» до «Доставлена». */
const STEPS = [
  { key: 'sent', label: 'Принята' },
  { key: 'confirmed', label: 'Подтверждена' },
  { key: 'assembled', label: 'Собрана' },
  { key: 'shipped', label: 'В пути' },
  { key: 'delivered', label: 'Доставлена' },
]
const stepIndex = (status: string) => STEPS.findIndex(s => s.key === status)
const open = ref<number | null>(null)

const date = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Minsk', day: 'numeric', month: 'long' })
</script>

<template>
  <AppPage id="orders" title="Мои заявки">
      <B24Container class="py-4 flex flex-col gap-3 max-w-2xl">
        <B24Alert v-if="error && error.statusCode !== 401" color="air-primary-alert" title="Не удалось загрузить заявки. Обновите страницу." />
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
              {{ o.items.length }} {{ plural(o.items.length, 'позиция', 'позиции', 'позиций') }} · {{ formatMoney(o.total, o.currency) }}
              <template v-if="o.onecNumber">
                · заказ {{ o.onecNumber }}
              </template>
            </p>
            <p class="text-sm">
              <template v-if="o.trip">
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
            <B24Button
              color="air-tertiary"
              size="sm"
              class="self-start"
              :label="open === o.id ? 'Скрыть состав' : 'Состав и статус'"
              @click="open = open === o.id ? null : o.id"
            />
            <template v-if="open === o.id">
              <ol v-if="o.status !== 'cancelled' && o.status !== 'pending'" class="flex flex-wrap gap-1 text-xs" aria-label="Статус доставки">
                <li v-for="(s, i) in STEPS" :key="s.key">
                  <B24Badge :color="i <= stepIndex(o.status) ? 'air-primary-success' : 'air-secondary'" :label="s.label" />
                </li>
              </ol>
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-xs text-(--ui-color-design-plain-na-content-secondary)">
                    <th class="py-1 font-normal">
                      Товар
                    </th>
                    <th class="py-1 font-normal text-right">
                      Кол-во
                    </th>
                    <th class="py-1 font-normal text-right">
                      Цена
                    </th>
                    <th class="py-1 font-normal text-right">
                      Сумма
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="it in o.items" :key="it.sku + it.name" class="border-t border-(--ui-color-divider-default)">
                    <td class="py-1 pr-2">
                      {{ it.name }}
                    </td>
                    <td class="py-1 text-right whitespace-nowrap">
                      {{ it.qty }} {{ it.unit }}
                    </td>
                    <td class="py-1 text-right whitespace-nowrap">
                      {{ formatMoney(it.price, o.currency) }}
                    </td>
                    <td class="py-1 text-right whitespace-nowrap">
                      {{ formatMoney(lineTotal(it.price, it.qty), o.currency) }}
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
      </B24Container>
  </AppPage>
</template>
