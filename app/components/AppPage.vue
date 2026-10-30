<!-- Страница кабинета: панель с заголовком (кнопка «назад», если задана) и прокручиваемым телом, подвал внизу тела. -->
<script setup lang="ts">
import ArrowLeftLIcon from '@bitrix24/b24icons-vue/outline/ArrowLeftLIcon'

/** `bottomBar` — внизу экрана телефона плавающая панель (корзина): подвал поднимаем над ней. */
defineProps<{ id: string, title: string, back?: string, bottomBar?: boolean }>()
// Предупреждение о данных клиента (ClientDataGate) — первой строкой тела страницы, а не поверх заголовка.
const notice = useState<string>('client-data-notice', () => '')
</script>

<template>
  <B24DashboardPanel :id="id">
    <template #header>
      <!-- Ширина заголовка ограничена: длинное название товара не раздувает страницу на телефоне (#77). -->
      <B24DashboardNavbar :b24ui="{ title: 'min-w-0 truncate' }">
        <template #leading>
          <B24Button v-if="back" :to="back" color="air-tertiary" :icon="ArrowLeftLIcon" aria-label="Назад" size="sm" />
        </template>
        <template #title>
          <span class="block min-w-0 truncate">{{ title }}</span>
        </template>
        <template #right>
          <slot name="right" />
        </template>
      </B24DashboardNavbar>
    </template>
    <template #body>
      <div class="flex min-h-full flex-col">
        <B24Alert v-if="notice" color="air-primary-warning" :title="notice" class="mb-2" />
        <div class="flex-1">
          <slot />
        </div>
        <AppFooter :class="bottomBar ? 'pb-28 md:pb-6' : ''" />
      </div>
    </template>
  </B24DashboardPanel>
</template>
