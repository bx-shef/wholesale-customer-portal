<!-- Доставка (#79): когда машина приедет в города клиента на ближайшие две недели и до какого времени принимается заявка. -->
<script setup lang="ts">
import { formatCutoff } from '~~/shared/delivery'

useHead({ title: 'Доставка' })

interface Day { date: string, cities: Array<{ city: string, cutoffAt: string, open: boolean }> }
const headers = useRequestHeaders(['cookie'])
const { data, error } = await useFetch<{ status: string, days: Day[], cities: string[] }>('/api/delivery-calendar', { headers })
if (error.value?.statusCode === 401) await navigateTo('/login')

const day = (date: string) => new Date(`${date}T09:00:00Z`).toLocaleDateString('ru-RU', { timeZone: 'Europe/Minsk', weekday: 'long', day: 'numeric', month: 'long' })
</script>

<template>
  <AppPage id="delivery" title="Доставка">
    <B24Container class="py-4 flex flex-col gap-3 max-w-2xl">
      <p class="text-sm">
        Дни, когда машина приедет в ваши города в ближайшие две недели. Заявку нужно отправить до указанного времени — тогда она поедет этим рейсом.
      </p>
      <B24Alert v-if="data?.status === 'unavailable'" color="air-primary-warning" title="График доставки сейчас недоступен. Дату доставки согласует менеджер." />
      <B24Empty
        v-else-if="data && !data.days.length"
        title="Ближайших рейсов в ваши города нет"
        description="Дату доставки согласует менеджер после заявки."
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
    </B24Container>
  </AppPage>
</template>
