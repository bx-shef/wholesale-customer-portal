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
import QuestionIcon from '@bitrix24/b24icons-vue/outline/QuestionIcon'
import LogOutIcon from '@bitrix24/b24icons-vue/outline/LogOutIcon'
import HamburgerMenuIcon from '@bitrix24/b24icons-vue/outline/HamburgerMenuIcon'

const route = useRoute()
const headers = useRequestHeaders(['cookie'])
const { data: me } = await useFetch('/api/auth/me', { headers, key: 'me' })
const cart = useCart()
const ai = useAiChat()
const router = useRouter()
const open = ref(false)
const { logout, logoutError } = useLogout()

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
  { label: 'Справка', icon: QuestionIcon, to: '/help', onSelect: close },
])
// Разделы каталога деревом и «Только в наличии» — в меню. Фильтры живут в адресе каталога:
// вне каталога переход открывает его с чистыми фильтрами.
const { data: filterOptions } = useLazyFetch('/api/catalog/filters', { headers, server: false, immediate: false, key: 'catalog-filters' })
watch(withMenu, (v) => { if (v && !filterOptions.value) refreshNuxtData('catalog-filters') }, { immediate: true })
const catalogFilters = computed(() => filtersFromQuery(route.path === '/' ? route.query : {}))
const tree = computed(() => sectionTree(filterOptions.value?.sections ?? []))
const openPath = computed(() => new Set(sectionPath(tree.value, catalogFilters.value.section).map(g => g.toLowerCase())))
function sectionLink(guid: string) {
  return { path: '/', query: filtersToQuery({ ...catalogFilters.value, section: guid }) }
}
function toItem(n: SectionNode): NavigationMenuItem {
  const active = route.path === '/' && n.guid.toLowerCase() === catalogFilters.value.section.toLowerCase()
  if (!n.children.length) return { label: n.name, to: sectionLink(n.guid), active, onSelect: close }
  return {
    label: n.name,
    defaultOpen: openPath.value.has(n.guid.toLowerCase()),
    children: [{ label: 'Все товары раздела', to: sectionLink(n.guid), active, onSelect: close }, ...n.children.map(toItem)],
  }
}
const sectionItems = computed<NavigationMenuItem[]>(() => tree.value.map(toItem))
function setInStock(v: boolean) {
  router.push({ path: '/', query: filtersToQuery({ ...catalogFilters.value, inStock: v }) })
}

const actions = computed<NavigationMenuItem[]>(() => [
  { label: 'Выйти', icon: LogOutIcon, onSelect: () => { close(); logout() } },
])

function bindCompany(id: number) {
  cart.load(id)
  setCacheCompany(id)
}
onMounted(() => { if (me.value) bindCompany(me.value.company.id) })
watch(me, (v) => { if (v) bindCompany(v.company.id) })

</script>

<template>
  <B24DashboardGroup v-if="withMenu" unit="px" :class="{ 'md:pr-[440px]': ai.open.value }" class="transition-[padding] duration-200">
    <B24DashboardSidebar id="lk" v-model:open="open" mode="slideover" collapsible class="border-e-1">
      <template #header="{ collapsed }">
        <B24DashboardSidebarCollapse :icon="HamburgerMenuIcon" class="size-9 px-2" />
        <!-- Логотип и название — не ссылка: в каталог ведёт пункт меню. -->
        <img v-if="!collapsed" src="/logo.png" alt="Алгена — личный кабинет" class="h-7 w-auto shrink-0">
      </template>
      <template #default="{ collapsed }">
        <B24NavigationMenu :collapsed="collapsed" :items="sections" orientation="vertical" />
        <div v-if="!collapsed && sectionItems.length" class="flex flex-col gap-2 border-t border-(--ui-color-divider-default) pt-3">
          <span class="px-2 text-xs font-semibold uppercase text-(--ui-color-design-plain-content)">Разделы каталога</span>
          <B24Switch :model-value="catalogFilters.inStock" label="Только в наличии" class="px-2" @update:model-value="v => setInStock(!!v)" />
          <B24NavigationMenu :items="sectionItems" orientation="vertical" />
        </div>
        <B24NavigationMenu :collapsed="collapsed" :items="actions" orientation="vertical" class="mt-auto" />
      </template>
      <template #footer="{ collapsed }">
        <!-- Компания клиента — вход в профиль, как пользователь внизу меню в templates-dashboard. -->
        <B24Button
          to="/profile"
          color="air-tertiary"
          :label="collapsed ? undefined : (me?.company.title || 'Профиль')"
          :title="me?.company.title"
          :avatar="{ text: (me?.company.title || '?').slice(0, 1) }"
          :active="route.path === '/profile'"
          block
          class="mb-1 justify-start truncate"
          @click="close"
        />
      </template>
    </B24DashboardSidebar>
    <slot />
    <B24Alert v-if="logoutError" color="air-primary-alert" :title="logoutError" class="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:w-96" />
  </B24DashboardGroup>
  <div v-else>
    <slot />
  </div>
</template>
