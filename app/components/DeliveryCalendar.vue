<!--
  Календарь доставок (2026-11-19): недели пн–вс на окно графика. Дни доставки подсвечены, в клетке —
  города и отсечка «до чт 23:59»; прошедшие дни и рейсы с закрытым приёмом — приглушены.
  На телефоне в клетке только точка, а города выбранного дня — списком под сеткой.
-->
<script setup lang="ts">
import { calendarWeeks, type CalendarCell, type CalendarDay } from '~~/shared/delivery'

const props = defineProps<{ days: CalendarDay[], from: string, count: number }>()

const weeks = computed(() => calendarWeeks(props.from, props.count, props.days))
const firstDelivery = computed(() => props.days.find(d => d.cities.length)?.date ?? null)
const picked = ref<string | null>(null)
const selected = computed(() => props.days.find(d => d.date === (picked.value ?? firstDelivery.value)) ?? null)

const tz = { timeZone: 'Europe/Minsk' } as const
const at = (date: string) => new Date(`${date}T09:00:00Z`)
const monthTitle = computed(() => {
  const months = [...new Set(weeks.value.flat().filter(c => c.inRange).map(c => at(c.date).toLocaleDateString('ru-RU', { ...tz, month: 'long', year: 'numeric' })))]
  return months.join(' — ')
})
const dayNum = (c: CalendarCell) => Number(c.date.slice(8))
const fullDay = (date: string) => at(date).toLocaleDateString('ru-RU', { ...tz, weekday: 'long', day: 'numeric', month: 'long' })
const cutoffShort = (iso: string) => {
  const d = new Date(iso)
  return `до ${d.toLocaleDateString('ru-RU', { ...tz, weekday: 'short' })} ${d.toLocaleTimeString('ru-RU', { ...tz, hour: '2-digit', minute: '2-digit' })}`
}
const isDelivery = (c: CalendarCell) => !!c.day?.cities.length
const anyOpen = (c: CalendarCell) => !!c.day?.cities.some(x => x.open)
const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
</script>

<template>
  <div class="flex flex-col gap-2">
    <p class="font-semibold first-letter:uppercase">
      {{ monthTitle }}
    </p>
    <!-- Сетка календаря: линии — фон контейнера в зазорах между белыми клетками. -->
    <div class="grid grid-cols-7 gap-px text-xs rounded-lg overflow-hidden border border-(--ui-color-divider-default) bg-(--ui-color-divider-default)">
      <div v-for="(w, k) in WEEKDAYS" :key="w" class="text-center py-1.5 font-semibold bg-(--ui-color-bg-content-secondary)" :class="k > 4 ? 'text-description' : ''">
        {{ w }}
      </div>
      <template v-for="(week, i) in weeks" :key="i">
        <button
          v-for="c in week"
          :key="c.date"
          type="button"
          :disabled="!isDelivery(c)"
          :aria-label="isDelivery(c) ? fullDay(c.date) : undefined"
          :data-testid="isDelivery(c) ? 'delivery-day' : undefined"
          class="min-w-0 min-h-11 sm:min-h-24 p-1.5 text-left flex flex-col gap-1 overflow-hidden"
          :class="[
            isDelivery(c) && anyOpen(c) ? 'bg-(--ui-color-accent-soft-blue-3) cursor-pointer' : 'bg-(--ui-color-bg-content-primary)',
            !c.inRange ? 'text-description' : '',
            isDelivery(c) && !anyOpen(c) ? 'opacity-60' : '',
            selected?.date === c.date ? 'ring-2 ring-inset ring-(--ui-color-accent-main-primary)' : '',
          ]"
          @click="picked = c.date"
        >
          <span class="font-semibold" :class="c.date === from ? 'inline-flex size-6 items-center justify-center rounded-full bg-(--ui-color-accent-main-primary) text-white' : ''">{{ dayNum(c) }}</span>
          <span v-if="isDelivery(c)" class="sm:hidden size-2 rounded-full self-center" :class="anyOpen(c) ? 'bg-(--ui-color-accent-main-primary)' : 'bg-(--ui-color-base-6)'" />
          <span v-for="x in c.day?.cities ?? []" :key="x.city" class="hidden sm:flex flex-col leading-tight" :class="x.open ? '' : 'line-through'">
            <b class="truncate">{{ x.city }}</b>
            <span class="text-description">{{ x.open ? cutoffShort(x.cutoffAt) : 'приём закрыт' }}</span>
          </span>
        </button>
      </template>
    </div>
    <div v-if="selected" class="sm:hidden flex flex-col gap-1 text-sm" data-testid="delivery-selected">
      <p class="font-semibold first-letter:uppercase">
        {{ fullDay(selected.date) }}
      </p>
      <div v-for="x in selected.cities" :key="x.city" class="flex flex-wrap items-center gap-2">
        <b>{{ x.city }}</b>
        <B24Badge v-if="x.open" color="air-primary-success" :label="`заявки ${cutoffShort(x.cutoffAt)}`" />
        <B24Badge v-else color="air-secondary" label="приём заявок закрыт" />
      </div>
    </div>
  </div>
</template>
