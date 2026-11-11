<!-- Доставка (#79): когда машина приедет в города клиента на ближайшие две недели и до какого времени принимается заявка. -->
<script setup lang="ts">
import { deliveryView, formatCutoff } from '~~/shared/delivery'

useHead({ title: 'Доставка' })

interface Day { date: string, cities: Array<{ city: string, cutoffAt: string, open: boolean }> }
const headers = useRequestHeaders(['cookie'])
const { data, error } = await useFetch<{ status: string, days: Day[], cities: string[], general?: Day[], noCity?: string[] }>('/api/delivery-calendar', { headers })
if (error.value?.statusCode === 401) await navigateTo('/login')

const view = computed(() => data.value ? deliveryView(data.value.status, data.value.days.length, data.value.cities.length) : null)
const showAll = ref(false)
const general = computed(() => view.value === 'own' && !showAll.value ? [] : (data.value?.general ?? []))

const day = (date: string) => new Date(`${date}T09:00:00Z`).toLocaleDateString('ru-RU', { timeZone: 'Europe/Minsk', weekday: 'long', day: 'numeric', month: 'long' })
</script>

<template>
  <AppPage id="delivery" title="Доставка">
    <B24Container class="py-4 flex flex-col gap-3 max-w-2xl">
      <p class="text-sm">
        Дни, когда машина приедет в ваши города в ближайшие две недели. Заявку нужно отправить до указанного времени — тогда она поедет этим рейсом.
      </p>
      <B24Alert v-if="data?.status === 'unavailable'" color="air-primary-warning" title="График доставки сейчас недоступен. Дату доставки согласует менеджер." />
      <template v-else-if="view === 'no-city'">
        <B24Alert
          v-for="a in data?.noCity ?? []"
          :key="a"
          color="air-primary-warning"
          :title="`В адресе «${a}» не указан город. Попросите менеджера дополнить адрес — тогда здесь будут дни доставки в ваш город.`"
        />
      </template>
      <B24Alert
        v-else-if="view === 'general'"
        color="air-primary"
        title="В ближайшие две недели рейсов в ваши города нет. Дату доставки согласует менеджер после заявки."
      />
      <B24Card v-for="d in data?.days ?? []" :key="d.date">
        <div class="flex flex-col gap-2 text-sm">
          <p class="font-semibold first-letter:uppercase">
            {{ day(d.date) }}
          </p>
          <div v-for="c in d.cities" :key="c.city" class="flex flex-wrap items-center gap-2">
            <b>{{ c.city }}</b>
            <B24Badge v-if="c.open" color="air-primary-success" :label="`заявки до ${formatCutoff(c.cutoffAt)}`" />
            <B24Badge v-else color="air-secondary" label="приём заявок на этот рейс закрыт" />
          </div>
        </div>
      </B24Card>
      <div v-if="view === 'own' && data?.general?.length">
        <B24Button color="air-tertiary" :label="showAll ? 'Свернуть весь график' : 'Весь график'" @click="showAll = !showAll" />
      </div>
      <template v-if="general.length">
        <h2 class="font-semibold mt-2">
          Общий график доставки
        </h2>
        <B24Card v-for="d in general" :key="`g-${d.date}`">
          <div class="flex flex-col gap-2 text-sm">
            <p class="font-semibold first-letter:uppercase">
              {{ day(d.date) }}
            </p>
            <div v-for="c in d.cities" :key="c.city" class="flex flex-wrap items-center gap-2">
              <b>{{ c.city }}</b>
              <B24Badge v-if="c.open" color="air-primary-success" :label="`заявки до ${formatCutoff(c.cutoffAt)}`" />
              <B24Badge v-else color="air-secondary" label="приём заявок на этот рейс закрыт" />
            </div>
          </div>
        </B24Card>
      </template>
    </B24Container>
  </AppPage>
</template>
