<!--
  Раскладка кабинета по шаблону bitrix24/templates-dashboard: боковое меню (на телефоне — выезжает
  по кнопке-бургеру) и страница-панель справа. Без сессии (вход, справка снаружи) и во фрейме
  коробки (/b24) меню нет — только страница.
-->
<script setup lang="ts">
import type { NavigationMenuItem } from '@bitrix24/b24ui-nuxt'
import ProductsCubeIcon from '@bitrix24/b24icons-vue/outline/ProductsCubeIcon'
import ShoppingCartIcon from '@bitrix24/b24icons-vue/outline/ShoppingCartIcon'
import DeliveryIcon from '@bitrix24/b24icons-vue/outline/DeliveryIcon'
import PersonIcon from '@bitrix24/b24icons-vue/outline/PersonIcon'
import QuestionIcon from '@bitrix24/b24icons-vue/outline/QuestionIcon'
import CopilotIcon from '@bitrix24/b24icons-vue/outline/CopilotIcon'
import LogOutIcon from '@bitrix24/b24icons-vue/outline/LogOutIcon'
import HamburgerMenuIcon from '@bitrix24/b24icons-vue/outline/HamburgerMenuIcon'

const route = useRoute()
const headers = useRequestHeaders(['cookie'])
const { data: me } = await useFetch('/api/auth/me', { headers, key: 'me' })
const cart = useCart()
const ai = useAiChat()
const open = ref(false)
const logoutError = ref('')

// Вход и фрейм коробки — без меню, даже если `me` ещё в памяти.
// Свёрнутость меню — в cookie (умолчание DashboardGroup): её видит и сервер, разметка при гидрации совпадает.
const withMenu = computed(() => !!me.value && route.path !== '/login' && !route.path.startsWith('/b24'))
const close = () => { open.value = false }

const sections = computed<NavigationMenuItem[]>(() => [
  { label: 'Каталог', icon: ProductsCubeIcon, to: '/', active: route.path === '/' || route.path.startsWith('/product'), onSelect: close },
  // Число в корзине известно только в браузере (localStorage): до монтирования его нет и на сервере,
  // поэтому разметка совпадает при гидрации.
  { label: 'Корзина', icon: ShoppingCartIcon, to: '/cart', badge: cart.loaded.value && cart.count.value ? String(cart.count.value) : undefined, onSelect: close },
  { label: 'Заявки', icon: DeliveryIcon, to: '/orders', onSelect: close },
  { label: 'Профиль', icon: PersonIcon, to: '/profile', onSelect: close },
  { label: 'Справка', icon: QuestionIcon, to: '/help', onSelect: close },
])
const actions = computed<NavigationMenuItem[]>(() => [
  { label: 'ИИ-помощник', icon: CopilotIcon, active: ai.open.value, onSelect: () => { close(); ai.toggle() } },
  { label: 'Выйти', icon: LogOutIcon, onSelect: () => { close(); logout() } },
])

function bindCompany(id: number) {
  cart.load(id)
  setCacheCompany(id)
}
onMounted(() => { if (me.value) bindCompany(me.value.company.id) })
watch(me, (v) => { if (v) bindCompany(v.company.id) })

async function logout() {
  logoutError.value = ''
  // Сохранённое с устройства уходит в любом случае.
  cart.forget()
  // Поиск и фильтры прежнего пользователя на общем устройстве не оставляем.
  try { localStorage.removeItem('wcp-catalog-filters') }
  catch { /* хранилище недоступно — стирать нечего */ }
  await clearCatalogCache()
  // Данные клиента из 1С — следующему вошедшему не показываем.
  clearNuxtState('client-data')
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
  }
  catch {
    // Без сети сервер сессию не закрыл: «вышли» показывать нельзя — следующий вошёл бы под ней.
    logoutError.value = 'Выйти не удалось: нет связи с сервером. Повторите, когда появится сеть.'
    return
  }
  // Сессии больше нет: меню и название компании не должны пережить выход.
  me.value = undefined
  clearNuxtData('me')
  await navigateTo('/login')
}
</script>

<template>
  <B24DashboardGroup v-if="withMenu" unit="px" :class="{ 'md:pr-[440px]': ai.open.value }" class="transition-[padding] duration-200">
    <B24DashboardSidebar id="lk" v-model:open="open" mode="slideover" collapsible class="border-e-1">
      <template #header="{ collapsed }">
        <B24DashboardSidebarCollapse :icon="HamburgerMenuIcon" class="size-9 px-2" />
        <!-- Логотип и название — не ссылка: в каталог ведёт пункт меню. -->
        <span v-if="!collapsed" class="flex min-w-0 items-center gap-2">
          <img src="/logo.png" alt="Алгена" class="h-7 w-auto shrink-0">
          <span class="truncate font-semibold">Личный кабинет</span>
        </span>
      </template>
      <template #default="{ collapsed }">
        <B24NavigationMenu :collapsed="collapsed" :items="sections" orientation="vertical" />
        <B24NavigationMenu :collapsed="collapsed" :items="actions" orientation="vertical" class="mt-auto" />
      </template>
      <template #footer="{ collapsed }">
        <span v-if="!collapsed" class="mb-2 truncate px-2 text-sm text-(--ui-color-design-plain-content)" :title="me?.company.title">
          {{ me?.company.title }}
        </span>
      </template>
    </B24DashboardSidebar>
    <slot />
    <B24Alert v-if="logoutError" color="air-primary-alert" :title="logoutError" class="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:w-96" />
  </B24DashboardGroup>
  <div v-else>
    <slot />
  </div>
</template>
