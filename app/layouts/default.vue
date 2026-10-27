<!--
  Раскладка кабинета по шаблону bitrix24/templates-dashboard: боковое меню (на телефоне — выезжает
  по кнопке-бургеру) и страница-панель справа. Без сессии (вход, справка снаружи) и во фрейме
  коробки (/b24) меню нет — только страница.
-->
<script setup lang="ts">
import type { DropdownMenuItem, NavigationMenuItem } from '@bitrix24/b24ui-nuxt'
import ProductsCubeIcon from '@bitrix24/b24icons-vue/outline/ProductsCubeIcon'
import ShoppingCartIcon from '@bitrix24/b24icons-vue/outline/ShoppingCartIcon'
import DeliveryIcon from '@bitrix24/b24icons-vue/outline/DeliveryIcon'
import QuestionIcon from '@bitrix24/b24icons-vue/outline/QuestionIcon'
import PersonIcon from '@bitrix24/b24icons-vue/outline/PersonIcon'
import ChevronTopSIcon from '@bitrix24/b24icons-vue/outline/ChevronTopSIcon'
import LogOutIcon from '@bitrix24/b24icons-vue/outline/LogOutIcon'
import HamburgerMenuIcon from '@bitrix24/b24icons-vue/outline/HamburgerMenuIcon'

const route = useRoute()
const headers = useRequestHeaders(['cookie'])
const { data: me } = await useFetch('/api/auth/me', { headers, key: 'me' })
const cart = useCart()
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
])
// В теме b24ui у пунктов меню фиксированная высота (h-9.5, у подписи h-5.5) и строка без переноса:
// перенесённое длинное название наезжало на соседний пункт. Высота — по содержимому; раскрытая
// группа не бледнеет (в теме opacity-70 — заголовок читался как неактивный).
const SECTION_MENU_UI = {
  link: 'h-auto min-h-9.5 items-start py-1.5 data-[state=open]:opacity-100 data-[state=open]:text-(length:--ui-font-size-md)',
  linkLabelWrapper: 'h-auto',
  linkLabel: 'whitespace-normal text-start leading-snug',
  linkTrailing: 'mt-0.5',
  childItem: 'h-auto min-h-9',
  childLink: 'h-auto min-h-9 items-start py-1.5 whitespace-normal',
  childLinkLabel: 'whitespace-normal text-start leading-snug',
}

// Разделы каталога деревом и «Только в наличии» — в меню. Фильтры живут в адресе каталога:
// вне каталога переход открывает его с чистыми фильтрами.
const { data: filterOptions } = useLazyFetch('/api/catalog/filters', { headers, server: false, immediate: false, key: 'catalog-filters' })
watch(withMenu, (v) => { if (v && !filterOptions.value) refreshNuxtData('catalog-filters') }, { immediate: true })
// «Только в наличии» помним и вне каталога и после перезагрузки (cookie — видна и серверу, гидрация совпадает): в карточке, корзине и профиле меню показывает то же.
const inStockKept = useCookie<boolean>('lk_in_stock', { default: () => true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
watch(() => route.path === '/' ? filtersFromQuery(route.query).inStock : null, (v) => { if (v !== null) inStockKept.value = v }, { immediate: true })
const catalogFilters = computed(() => route.path === '/' ? filtersFromQuery(route.query) : { ...filtersFromQuery({}), inStock: inStockKept.value })
const tree = computed(() => {
  const all = sectionTree(filterOptions.value?.sections ?? [])
  // При «Только в наличии» пустые папки не показываем.
  // Пустые разделы (без товаров) не показываем; при «Только в наличии» — без товаров в наличии.
  return pruneTree(all, (catalogFilters.value.inStock ? filterOptions.value?.stockSections : filterOptions.value?.itemSections) ?? [])
})
const openPath = computed(() => new Set(sectionPath(tree.value, catalogFilters.value.section).map(g => g.toLowerCase())))
function sectionLink(guid: string) {
  return { path: '/', query: filtersToQuery({ ...catalogFilters.value, section: guid, sub: [], props: {} }) }
}
// В меню — два уровня: группа и раздел. Третий уровень — кнопками над списком товаров (страница каталога).
function toItem(n: SectionNode, depth = 1): NavigationMenuItem {
  const active = route.path === '/' && n.guid.toLowerCase() === catalogFilters.value.section.toLowerCase()
  // value — guid: раскрытие держится за раздел, а не за номер строки (список меняется от «В наличии»).
  if (!n.children.length || depth >= 2) return { label: n.name, value: n.guid, to: sectionLink(n.guid), active, onSelect: close }
  return {
    label: n.name,
    value: n.guid,
    defaultOpen: openPath.value.has(n.guid.toLowerCase()),
    children: [{ label: 'Все товары раздела', value: `${n.guid}:all`, to: sectionLink(n.guid), active, onSelect: close }, ...n.children.map(c => toItem(c, depth + 1))],
  }
}
const sectionItems = computed<NavigationMenuItem[]>(() => tree.value.map(n => toItem(n)))
function setInStock(v: boolean) {
  router.push({ path: '/', query: filtersToQuery({ ...catalogFilters.value, inStock: v }) })
}

// Меню компании внизу — как меню пользователя в templates-dashboard: профиль, справка, выход.
const companyMenu = computed<DropdownMenuItem[][]>(() => [
  [{ type: 'label', label: me.value?.company.title || '' }],
  [
    { label: 'Профиль', icon: PersonIcon, to: '/profile', onSelect: close },
    { label: 'Справка', icon: QuestionIcon, to: '/help', onSelect: close },
  ],
  [{ label: 'Выйти', icon: LogOutIcon, onSelect: () => { close(); logout() } }],
])

function bindCompany(id: number) {
  cart.load(id)
  setCacheCompany(id)
}
onMounted(() => { if (me.value) bindCompany(me.value.company.id) })
watch(me, (v) => { if (v) bindCompany(v.company.id) })

</script>

<template>
  <B24DashboardGroup v-if="withMenu" unit="px">
    <B24DashboardSidebar id="lk" v-model:open="open" mode="slideover" collapsible class="border-e-1" :b24ui="{ header: 'h-auto min-h-(--b24ui-header-height) flex-wrap py-2' }">
      <template #header="{ collapsed }">
        <B24DashboardSidebarCollapse :icon="HamburgerMenuIcon" class="size-9 px-2" />
        <!-- Логотип и название — не ссылка: в каталог ведёт пункт меню. -->
        <img v-if="!collapsed" src="/logo.png" alt="Алгена — личный кабинет" class="h-7 w-auto shrink-0">
        <!-- «В наличии» — в шапке меню: она не прокручивается вместе с длинным списком разделов. -->
        <B24Switch v-if="!collapsed" :model-value="catalogFilters.inStock" size="xs" label="Только в наличии" class="basis-full ps-1 pb-2" @update:model-value="v => setInStock(!!v)" />
      </template>
      <template #default="{ collapsed }">
        <B24NavigationMenu :collapsed="collapsed" :items="sections" orientation="vertical" />
        <div v-if="!collapsed && sectionItems.length" class="flex flex-col gap-2 border-t border-(--ui-color-divider-default) pt-3">
          <span class="px-2.5 text-xs font-semibold uppercase text-(--ui-color-design-plain-content)">Разделы</span>
          <!-- Длинные названия разделов 1С переносим, а не обрезаем: иначе «Материалы для внутрен…» не прочитать. -->
          <B24NavigationMenu
            :items="sectionItems"
            orientation="vertical"
            :b24ui="SECTION_MENU_UI"
          />
        </div>
      </template>
      <template #footer="{ collapsed }">
        <!-- Компания клиента — вход в профиль, как пользователь внизу меню в templates-dashboard.
             Название целиком (не обрезаем — владелец 2026-10-27), по центру; аватар тёплый, белые буквы ≥ 4.5:1. -->
        <B24DropdownMenu :items="companyMenu" :content="{ side: 'top', align: 'start' }" class="w-full">
          <B24Button
            color="air-tertiary"
            :label="collapsed ? undefined : (me?.company.title || 'Профиль')"
            :title="me?.company.title"
            :avatar="{ text: initials(me?.company.title || ''), size: 'md', class: 'bg-linear-to-br from-amber-700 to-orange-700 ring-0', b24ui: { fallback: 'text-white font-semibold' } }"
            :trailing-icon="collapsed ? undefined : ChevronTopSIcon"
            :active="route.path === '/profile' || route.path === '/help'"
            block
            class="mb-1 h-auto min-h-10 justify-start py-1 text-start"
            :b24ui="{ trailingIcon: 'ms-auto', baseLine: 'h-auto py-1', label: 'h-auto flex-1 justify-center whitespace-normal text-center leading-snug', labelInner: 'whitespace-normal break-words text-center' }"
          />
        </B24DropdownMenu>
      </template>
    </B24DashboardSidebar>
    <slot />
    <B24Alert v-if="logoutError" color="air-primary-alert" :title="logoutError" class="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:w-96" />
  </B24DashboardGroup>
  <div v-else>
    <slot />
  </div>
</template>
