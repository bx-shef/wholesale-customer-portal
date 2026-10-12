<!-- «Мои заявки»: статус и дата машины — только по компании из сессии. -->
<script setup lang="ts">
import DeliveryIcon from '@bitrix24/b24icons-vue/outline/DeliveryIcon'

useHead({ title: 'Заявки' })

interface Order {
  id: number
  createdAt: string
  status: string
  deliveryAt: string | null
  address: string
  total: number
  currency: string
  onecNumber: string | null
  shipmentDate: string | null
  items: { name: string, sku: string, qty: number, unit: string }[]
}

const headers = useRequestHeaders(['cookie'])
const { data, error } = await useFetch<{ items: Order[] }>('/api/orders', { headers })
if (error.value?.statusCode === 401) await navigateTo('/login')

const date = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
const dateTime = (iso: string) => new Date(iso).toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <div class="pb-16 md:pb-0">
    <AppHeader title="Мои заявки" />
    <B24Main>
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
              <p class="font-semibold">
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
              <template v-if="o.shipmentDate">
                Отгрузка: <b>{{ date(o.shipmentDate) }}</b>
              </template>
              <template v-else-if="o.deliveryAt">
                Машина: <b>{{ dateTime(o.deliveryAt) }}</b>
              </template>
              <template v-else>
                Дату доставки согласует менеджер
              </template>
              · {{ o.address }}
            </p>
          </div>
        </B24Card>
      </B24Container>
    </B24Main>
    <BottomNav />
  </div>
</template>
