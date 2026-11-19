<!-- Доставка (#79): когда машина приедет в города клиента на ближайшие две недели и до какого времени принимается заявка. -->
<script setup lang="ts">
import { deliveryView, type CalendarDay } from '~~/shared/delivery'

useHead({ title: 'Доставка' })

interface AddressCity { address: string, city: string | null, source: 'column' | 'text' | 'none' }
const headers = useRequestHeaders(['cookie'])
const { data, error } = await useFetch<{ status: string, days: CalendarDay[], cities: string[], general?: CalendarDay[], noCity?: string[], addresses?: AddressCity[], region?: string | null, byRegion?: boolean }>('/api/delivery-calendar', { headers })
if (error.value?.statusCode === 401) await navigateTo('/login')

const view = computed(() => data.value ? deliveryView(data.value.status, data.value.days.length, data.value.cities.length) : null)
const showAll = ref(false)
const general = computed(() => view.value === 'own' && !showAll.value ? [] : (data.value?.general ?? []))
// Окно графика — с сегодняшнего дня по Минску на две недели (как CLIENT_CALENDAR_DAYS на сервере).
const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10)
const SOURCE: Record<AddressCity['source'], string> = { column: 'из адреса', text: 'из текста адреса', none: 'город не определён' }
</script>

<template>
  <AppPage id="delivery" title="Доставка">
    <B24Container class="py-4 flex flex-col gap-3 max-w-4xl">
      <p class="text-sm">
        Дни, когда машина приедет в ваши города в ближайшие две недели. Заявку нужно отправить до указанного времени — тогда она поедет этим рейсом.
      </p>
      <B24Card v-if="data?.addresses?.length || data?.region" data-testid="delivery-where">
        <div class="flex flex-col gap-2 text-sm">
          <p class="font-semibold">
            Куда возим
          </p>
          <div v-for="a in data?.addresses ?? []" :key="a.address" class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="min-w-0 break-words">{{ a.address || 'адрес без текста' }}</span>
            <B24Badge v-if="a.city" color="air-primary-success" :label="`${a.city} — ${SOURCE[a.source]}`" />
            <B24Badge v-else color="air-primary-warning" :label="SOURCE.none" />
          </div>
          <p v-if="data?.region" class="text-description">
            Бизнес-регион: <b>{{ data.region }}</b><span v-if="data.byRegion"> — адрес без города, дни по бизнес-региону</span>
          </p>
        </div>
      </B24Card>
      <B24Alert v-if="data?.status === 'unavailable'" color="air-primary-warning" title="График доставки сейчас недоступен. Дату доставки согласует менеджер." />
      <B24Empty v-else-if="view === 'none'" title="График доставки появится после оформления договора" description="Дату доставки согласует менеджер." />
      <template v-else>
        <B24Alert
          v-for="a in data?.noCity ?? []"
          :key="a"
          color="air-primary-warning"
          :title="`В адресе «${a}» не указан город. Попросите менеджера дополнить адрес — тогда здесь будут дни доставки в ваш город.`"
        />
      </template>
      <B24Alert
        v-if="view === 'general'"
        color="air-primary"
        title="В ближайшие две недели рейсов в ваши города нет. Дату доставки согласует менеджер после заявки."
      />
      <DeliveryCalendar v-if="data?.days?.length" :days="data.days" :from="today" :count="14" />
      <div v-if="view === 'own' && data?.general?.length">
        <B24Button color="air-tertiary" :label="showAll ? 'Свернуть весь график' : 'Показать весь график'" @click="showAll = !showAll" />
      </div>
      <template v-if="general.length">
        <h2 class="font-semibold mt-2">
          Общий график доставки
        </h2>
        <DeliveryCalendar :days="general" :from="today" :count="14" />
      </template>
    </B24Container>
  </AppPage>
</template>
