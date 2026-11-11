<!-- Доставка (#79): когда машина приедет в города клиента на ближайшие две недели и до какого времени принимается заявка. -->
<script setup lang="ts">
import { deliveryView } from '~~/shared/delivery'
import type { Day } from '~/components/DeliveryDayCard.vue'

useHead({ title: 'Доставка' })

const headers = useRequestHeaders(['cookie'])
const { data, error } = await useFetch<{ status: string, days: Day[], cities: string[], general?: Day[], noCity?: string[] }>('/api/delivery-calendar', { headers })
if (error.value?.statusCode === 401) await navigateTo('/login')

const view = computed(() => data.value ? deliveryView(data.value.status, data.value.days.length, data.value.cities.length) : null)
const showAll = ref(false)
const general = computed(() => view.value === 'own' && !showAll.value ? [] : (data.value?.general ?? []))
</script>

<template>
  <AppPage id="delivery" title="Доставка">
    <B24Container class="py-4 flex flex-col gap-3 max-w-2xl">
      <p class="text-sm">
        Дни, когда машина приедет в ваши города в ближайшие две недели. Заявку нужно отправить до указанного времени — тогда она поедет этим рейсом.
      </p>
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
      <DeliveryDayCard v-for="d in data?.days ?? []" :key="d.date" :day="d" />
      <div v-if="view === 'own' && data?.general?.length">
        <B24Button color="air-tertiary" :label="showAll ? 'Свернуть весь график' : 'Весь график'" @click="showAll = !showAll" />
      </div>
      <template v-if="general.length">
        <h2 class="font-semibold mt-2">
          Общий график доставки
        </h2>
        <DeliveryDayCard v-for="d in general" :key="`g-${d.date}`" :day="d" />
      </template>
    </B24Container>
  </AppPage>
</template>
