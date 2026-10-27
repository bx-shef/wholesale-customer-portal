<!-- Количество с кратностью: шаг — упаковка, меньше минимума не уходит, больше `max` не растёт (правила — shared/cart.ts). -->
<script setup lang="ts">
import { normalizeQty } from '~~/shared/cart'

const props = withDefaults(defineProps<{ qty: number, packQty: number, minQty: number, unit: string, max?: number }>(), { max: Infinity })
const emit = defineEmits<{ 'update:qty': [value: number] }>()

const step = computed(() => (props.packQty > 0 ? props.packQty : 1))
const min = computed(() => normalizeQty(props.minQty, props.packQty, props.minQty))
const round = (v: number) => Math.round(v * 1000) / 1000

function dec() {
  const next = round(props.qty - step.value)
  emit('update:qty', next < min.value ? 0 : next)
}
const next = computed(() => (props.qty === 0 ? min.value : round(props.qty + step.value)))
const atMax = computed(() => next.value > props.max)
function inc() {
  if (!atMax.value) emit('update:qty', next.value)
}
</script>

<template>
  <div class="flex items-center gap-2">
    <B24Button color="air-secondary" label="−" class="min-w-11 justify-center" :aria-label="`Уменьшить на ${formatQty(step, unit)}`" @click="dec" />
    <span class="min-w-20 text-center font-medium" aria-live="polite">{{ formatQty(qty, unit) }}</span>
    <B24Button color="air-secondary" label="+" class="min-w-11 justify-center" :aria-label="`Увеличить на ${formatQty(step, unit)}`" :disabled="atMax" @click="inc" />
  </div>
</template>
