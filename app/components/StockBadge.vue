<!-- Остаток товара бейджем: одна точка подписи для списка, карточки и аналогов. -->
<script setup lang="ts">
const props = defineProps<{ available: number, unit: string }>()
const label = computed(() => stockLabel(props.available, props.unit))
</script>

<template>
  <B24Badge size="sm" :color="label.color" :label="label.text" />
</template>
