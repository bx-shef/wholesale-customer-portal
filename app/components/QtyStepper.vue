<!-- Количество с кратностью: шаг — упаковка, меньше минимума не уходит, больше `max` не растёт (правила — shared/cart.ts).
     Число можно набрать с клавиатуры: при уходе из поля или Enter оно округляется до упаковки. -->
<script setup lang="ts">
import { normalizeQty } from '~~/shared/cart'
import { parseQtyInput } from '~~/shared/qtyInput'

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

// Набранный текст живёт в поле до подтверждения: округлять на каждой клавише значило бы мешать набору.
const show = (v: number) => String(v).replace('.', ',')
const text = ref(show(props.qty))
watch(() => props.qty, (v) => { text.value = show(v) })
function commit() {
  const v = parseQtyInput(text.value, props.packQty, props.minQty, props.max) ?? props.qty
  text.value = show(v)
  if (v !== props.qty) emit('update:qty', v)
}
</script>

<template>
  <div class="flex items-center gap-2">
    <B24Button color="air-secondary" label="−" class="min-w-11 justify-center" :aria-label="`Уменьшить на ${formatQty(step, unit)}`" @click="dec" />
    <B24Input
      :model-value="text"
      inputmode="decimal"
      class="w-24"
      :ui="{ base: 'text-center font-medium' }"
      :aria-label="`Количество, ${unit}`"
      @update:model-value="v => text = String(v)"
      @blur="commit"
      @keydown.enter="(e: KeyboardEvent) => (e.target as HTMLInputElement).blur()"
    >
      <template #trailing>
        <span class="text-xs">{{ unit }}</span>
      </template>
    </B24Input>
    <B24Button color="air-secondary" label="+" class="min-w-11 justify-center" :aria-label="`Увеличить на ${formatQty(step, unit)}`" :disabled="atMax" @click="inc" />
  </div>
</template>
