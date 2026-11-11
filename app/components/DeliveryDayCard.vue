<!-- День графика доставки (#79): дата, города и до какого времени принимается заявка. -->
<script setup lang="ts">
import { formatCutoff } from '~~/shared/delivery'

export interface Day { date: string, cities: Array<{ city: string, cutoffAt: string, open: boolean }> }
defineProps<{ day: Day }>()

const label = (date: string) => new Date(`${date}T09:00:00Z`).toLocaleDateString('ru-RU', { timeZone: 'Europe/Minsk', weekday: 'long', day: 'numeric', month: 'long' })
</script>

<template>
  <B24Card>
    <div class="flex flex-col gap-2 text-sm">
      <p class="font-semibold first-letter:uppercase">
        {{ label(day.date) }}
      </p>
      <div v-for="c in day.cities" :key="c.city" class="flex flex-wrap items-center gap-2">
        <b>{{ c.city }}</b>
        <B24Badge v-if="c.open" color="air-primary-success" :label="`заявки до ${formatCutoff(c.cutoffAt)}`" />
        <B24Badge v-else color="air-secondary" label="приём заявок на этот рейс закрыт" />
      </div>
    </div>
  </B24Card>
</template>
