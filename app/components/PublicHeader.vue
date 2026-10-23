<!-- Шапка без входа (страница входа, справка снаружи): логотип и название — не ссылка. -->
<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <header class="flex h-16 items-center justify-between gap-3 border-b border-(--ui-color-divider-default) bg-(--ui-color-bg-content-primary) px-4">
    <span class="flex min-w-0 items-center gap-3">
      <img src="/logo.png" alt="Алгена" class="h-7 w-auto shrink-0">
      <span class="truncate font-semibold">{{ title }}</span>
    </span>
    <slot name="right" />
  </header>
</template>
