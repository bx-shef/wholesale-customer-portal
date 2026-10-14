<!-- Подвал: контакты поставщика и режим работы — на всех страницах, включая вход. -->
<script setup lang="ts">
import { COMPANY } from '~~/shared/company'
</script>

<template>
  <footer class="border-t border-(--ui-color-divider-default) px-4 py-6 text-sm text-(--ui-color-design-plain-content)">
    <div class="mx-auto flex max-w-5xl flex-wrap items-start justify-between gap-4">
      <div class="flex items-center gap-3">
        <img src="/logo.png" :alt="COMPANY.name" class="h-6 w-auto">
        <a :href="COMPANY.site" target="_blank" rel="noopener" class="underline">algena.by</a>
      </div>
      <address class="flex flex-col gap-0.5 not-italic">
        <span>{{ COMPANY.address }}</span>
        <a :href="`mailto:${COMPANY.email}`" class="underline">{{ COMPANY.email }}</a>
        <span>GLN: {{ COMPANY.gln }}</span>
      </address>
      <div class="flex flex-col gap-0.5">
        <span class="font-medium">Режим работы</span>
        <span v-for="h in COMPANY.hours" :key="h.days">{{ h.days }}: {{ h.time }}</span>
      </div>
    </div>
  </footer>
</template>
