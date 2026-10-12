<!-- Нижняя навигация на телефоне: до основных разделов одним пальцем (docs/spec.md §9). -->
<script setup lang="ts">
const route = useRoute()
const { count } = useCart()
const links = [
  { to: '/', label: 'Каталог' },
  { to: '/cart', label: 'Корзина' },
  { to: '/orders', label: 'Заявки' },
  { to: '/profile', label: 'Профиль' },
]
const active = (to: string) => (to === '/' ? route.path === '/' || route.path.startsWith('/product') : route.path.startsWith(to))
</script>

<template>
  <nav class="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-(--ui-color-divider-default) bg-(--ui-color-bg-content-primary) md:hidden" aria-label="Разделы">
    <B24Button
      v-for="l in links"
      :key="l.to"
      :to="l.to"
      :color="active(l.to) ? 'air-primary' : 'air-tertiary'"
      size="sm"
      class="min-h-11 justify-center gap-1 rounded-none px-1"
      :aria-label="l.to === '/cart' && count ? `Корзина, товаров: ${count}` : l.label"
    >
      {{ l.label }}
      <B24Badge v-if="l.to === '/cart' && count" size="xs" color="air-primary-alert" :label="String(count)" />
    </B24Button>
  </nav>
</template>
