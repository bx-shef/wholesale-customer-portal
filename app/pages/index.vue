<!-- Каталог: поиск, фильтры в шторке, подгрузка при прокрутке, цены договора клиента. Состояние — в адресе. -->
<script setup lang="ts">
import ProductIcon from '@bitrix24/b24icons-vue/outline/ProductIcon'
import { normalizeQty } from '~~/shared/cart'
import type { CatalogItemView, CatalogPageView } from '~~/shared/catalogView'

useHead({ title: 'Каталог' })

const PAGE = 30
const cart = useCart()
const route = useRoute()
const router = useRouter()
const headers = useRequestHeaders(['cookie'])

const { error: meError } = await useFetch('/api/auth/me', { headers, key: 'me' })
if (meError.value?.statusCode === 401) await navigateTo('/login')

const { data: options } = await useFetch('/api/catalog/filters', { headers })

// Адрес — источник правды: «назад» и ссылка с фильтрами работают без отдельной синхронизации.
const filters = computed(() => filtersFromQuery(route.query))
function setFilters(patch: Partial<CatalogFilters>) {
  router.push({ query: filtersToQuery({ ...filters.value, ...patch }) })
}

// Первая страница — уже в браузере: цены идут из 1С не мгновенно, и пусть клиент сразу видит
// каталог с загрузчиком, а не пустую вкладку, пока сервер ждёт 1С.
const { data: first, error: firstError, status } = await useAsyncData(
  'catalog-first',
  () => $fetch<CatalogPageView>('/api/catalog', { headers, query: { ...filtersToQuery(filters.value), limit: PAGE } }),
  { watch: [filters], server: false, lazy: true },
)
watch(firstError, (e) => {
  if (e?.statusCode === 401) navigateTo('/login')
})

const extra = ref<CatalogItemView[]>([])
const items = computed(() => [...(first.value?.items ?? []), ...extra.value])
const total = computed(() => first.value?.total ?? 0)
const priceStatus = computed(() => first.value?.priceStatus ?? 'ok')
const loadingMore = ref(false)
const moreFailed = ref(false)
const loading = computed(() => status.value === 'pending' || loadingMore.value)
watch(first, () => {
  extra.value = []
  moreFailed.value = false
})

// Номер выборки: ответ подгрузки, пришедший после смены фильтров, отбрасывается.
let generation = 0
watch(filters, () => generation++)

async function loadMore() {
  if (loadingMore.value || items.value.length >= total.value) return
  const gen = generation
  loadingMore.value = true
  moreFailed.value = false
  try {
    const page = await $fetch<CatalogPageView>('/api/catalog', {
      query: { ...filtersToQuery(filters.value), offset: items.value.length, limit: PAGE },
    })
    if (gen === generation) extra.value = [...extra.value, ...page.items]
  }
  catch (e) {
    if ((e as { statusCode?: number }).statusCode === 401) return navigateTo('/login')
    moreFailed.value = true
  }
  finally {
    loadingMore.value = false
  }
}

const search = ref(filters.value.q)
watch(() => filters.value.q, (q) => {
  if (q !== search.value.trim()) search.value = q
})
// Поиск — после паузы в наборе, а не на каждую букву.
let timer: ReturnType<typeof setTimeout> | undefined
watch(search, (v) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (v.trim() !== filters.value.q) setFilters({ q: v })
  }, 300)
})

const more = computed(() => items.value.length < total.value)
const sentinel = ref<HTMLElement>()
let sentinelVisible = false
// Поиск и фильтры запоминаются: вернулся в каталог из карточки или корзины — всё как было.
const SAVED_KEY = 'wcp-catalog-filters'
// «Только в наличии» — из той же cookie, что у переключателя в меню: иначе восстановленные фильтры
// включали его, когда в меню он выключен.
const inStockKept = useCookie<boolean>('lk_in_stock', { default: () => false, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}') as Record<string, string>
    delete saved.inStock
    if (inStockKept.value) saved.inStock = '1'
    if (Object.keys(route.query).length === 0 && Object.keys(saved).length > 0) router.replace({ query: saved })
  }
  catch { /* хранилище недоступно — каталог просто без сохранённых фильтров */ }
  watch(filters, (f) => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(filtersToQuery(f)))
    }
    catch { /* приватный режим */ }
  })
  const io = new IntersectionObserver((entries) => {
    sentinelVisible = entries.some(e => e.isIntersecting)
    if (sentinelVisible && !moreFailed.value) loadMore()
  }, { rootMargin: '400px' })
  watch(sentinel, (el, old) => {
    if (old) io.unobserve(old)
    if (el) io.observe(el)
  }, { immediate: true })
  // Страница пришла, а метка всё ещё видна (высокий экран) — событие пересечения не повторится, грузим сами.
  watch(loading, (now) => {
    if (!now && sentinelVisible && more.value && !moreFailed.value) loadMore()
  })
  onBeforeUnmount(() => {
    io.disconnect()
    clearTimeout(timer)
  })
})

// Фильтры: на телефоне — шторка снизу, на компьютере — окно. Раздел и «в наличии» — в левом меню.
const filtersOpen = ref(false)
const desktop = ref(false)
onMounted(() => {
  const mq = window.matchMedia('(min-width: 768px)')
  desktop.value = mq.matches
  mq.addEventListener('change', e => { desktop.value = e.matches })
})
// resolveComponent — только в setup: внутри computed он не находит компонент, и окно не открывалось.
const ModalPanel = resolveComponent('B24Modal')
const DrawerPanel = resolveComponent('B24Drawer')
const FilterPanel = computed(() => (desktop.value ? ModalPanel : DrawerPanel))
const panelProps = computed(() => (desktop.value ? {} : { direction: 'bottom', handle: true }))
const sortItems = SORT_ITEMS
const brandItems = computed(() => (options.value?.brands ?? []).map(b => b.trim()).filter(Boolean).map(b => ({ label: b, value: b })))
const sectionName = computed(() => options.value?.sections.find(s => s.guid === filters.value.section)?.name)
const activeCount = computed(() => filters.value.brand.length + (filters.value.sort !== 'name' ? 1 : 0))
// Третий уровень: подразделы выбранного раздела кнопками; можно выбрать несколько.
const subSections = computed(() => {
  const sec = filters.value.section.toLowerCase()
  if (!sec) return []
  const keep = new Set((filters.value.inStock ? options.value?.stockSections : options.value?.itemSections)?.map(g => g.toLowerCase()) ?? [])
  const all = options.value?.sections ?? []
  const hasGoods = (g: string): boolean => keep.has(g) || all.some(s => s.parentGuid?.toLowerCase() === g && hasGoods(s.guid.toLowerCase()))
  return all.filter(s => s.parentGuid?.toLowerCase() === sec && hasGoods(s.guid.toLowerCase()))
})
function toggleSub(guid: string) {
  const cur = filters.value.sub
  setFilters({ sub: cur.includes(guid) ? cur.filter(g => g !== guid) : [...cur, guid] })
}
const brandsOf = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])

/** «Сбросить» в фильтрах — только то, что в них: бренды и сортировка. Раздел и наличие задаёт меню. */
function reset() {
  setFilters({ brand: [], sort: 'name' })
}
/** Пустой результат — сбросить всё: поиск, раздел, наличие, бренды. */
function resetAll() {
  search.value = ''
  router.push({ query: {} })
}

</script>

<template>
  <AppPage id="catalog" title="Каталог">
      <B24Container class="py-4 flex flex-col gap-3">
        <!-- Поиск и фильтры прилипают под шапкой: при прокрутке длинного каталога они под рукой. -->
        <div class="sticky top-0 z-10 -mx-4 flex gap-2 bg-(--ui-color-bg-content-secondary) px-4 py-2 sm:-mx-6 sm:px-6">
          <B24Input v-model="search" type="search" placeholder="Название или артикул" class="flex-1" aria-label="Поиск по каталогу" />
          <B24Button color="air-secondary" :label="activeCount ? `Фильтры · ${activeCount}` : 'Фильтры'" @click="filtersOpen = true" />
        </div>

        <div v-if="subSections.length" class="flex flex-wrap gap-2" role="group" aria-label="Подразделы">
          <B24Button
            v-for="s in subSections"
            :key="s.guid"
            size="sm"
            :color="filters.sub.includes(s.guid) ? 'air-primary' : 'air-tertiary'"
            :label="s.name"
            :aria-pressed="filters.sub.includes(s.guid)"
            @click="toggleSub(s.guid)"
          />
        </div>

        <div v-if="sectionName || filters.brand.length || filters.inStock" class="flex flex-wrap gap-2">
          <B24Button v-if="sectionName" size="sm" color="air-secondary-accent" :label="`${sectionName} ✕`" :aria-label="`Убрать фильтр: ${sectionName}`" @click="setFilters({ section: '', sub: [] })" />
          <B24Button v-for="b in filters.brand" :key="b" size="sm" color="air-secondary-accent" :label="`${b} ✕`" :aria-label="`Убрать фильтр: ${b}`" @click="setFilters({ brand: filters.brand.filter(x => x !== b) })" />
          <B24Button v-if="filters.inStock" size="sm" color="air-secondary-accent" label="В наличии ✕" aria-label="Убрать фильтр: в наличии" @click="setFilters({ inStock: false })" />
        </div>

        <B24Alert v-if="priceStatus === 'unavailable'" color="air-primary-warning" title="Цены временно недоступны" description="Каталог и остатки показываем, цены появятся, как только ответит учётная система. Обновите страницу через минуту." />
        <B24Alert v-else-if="priceStatus === 'no-contract'" color="air-primary-warning" title="Цены пока не подключены" description="Ваша компания ещё не связана с договором в учётной системе. Обратитесь к менеджеру — после подключения цены появятся здесь." />
        <B24Alert v-if="firstError && firstError.statusCode !== 401" color="air-primary-alert" title="Не удалось загрузить каталог" description="Проверьте связь и обновите страницу." />

        <p v-if="items.length" class="text-sm text-(--ui-color-design-plain-na-content-secondary)">
          Найдено: {{ total }}
        </p>

        <B24Empty
          v-if="status === 'success' && !loadingMore && items.length === 0"
          :icon="ProductIcon"
          title="Ничего не нашлось"
          :description="filters.q || activeCount || filters.section || filters.inStock ? 'Измените запрос или сбросьте фильтры.' : 'Каталог ещё загружается из учётной системы. Обновите страницу через пару минут.'"
          :actions="filters.q || activeCount || filters.section || filters.inStock ? [{ label: 'Сбросить', onClick: resetAll }] : []"
        />

        <ul class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <li v-for="it in items" :key="it.guid">
            <!-- Карточка — не ссылка целиком: внутри кнопки корзины, а кнопка в ссылке — невалидная разметка. -->
            <B24Card class="h-full">
              <div class="flex gap-3">
                <NuxtLink :to="`/product/${it.guid}`" class="shrink-0">
                  <img v-if="it.image" :src="it.image" alt="" onerror="this.remove()" loading="lazy" class="size-16 rounded object-contain bg-white">
                </NuxtLink>
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <NuxtLink :to="`/product/${it.guid}`" class="font-medium leading-snug hover:underline">
                    {{ it.name }}
                  </NuxtLink>
                  <p class="text-xs text-(--ui-color-design-plain-na-content-secondary)">
                    {{ it.sku }} · {{ it.brand }}
                  </p>
                  <div class="flex items-center justify-between gap-2 pt-1">
                    <span class="font-semibold">{{ it.price ? formatMoney(it.price.value, it.price.currency) : '—' }}<span class="text-xs font-normal"> / {{ it.unit }}</span></span>
                    <StockBadge :available="it.available" :unit="it.unit" />
                  </div>
                  <div v-if="it.price && it.available > 0" class="flex items-center gap-2 pt-1">
                    <B24Button v-if="!cart.qtyOf(it.guid)" color="air-primary" size="sm" label="В корзину" @click="cart.setQty(it.guid, normalizeQty(it.minQty, it.packQty, it.minQty))" />
                    <QtyStepper v-else :qty="cart.qtyOf(it.guid)" :pack-qty="it.packQty" :min-qty="it.minQty" :unit="it.unit" @update:qty="v => cart.setQty(it.guid, v)" />
                  </div>
                </div>
              </div>
            </B24Card>
          </li>
        </ul>

        <div ref="sentinel" />
        <B24Alert v-if="moreFailed" color="air-primary-alert" title="Не удалось загрузить следующие товары" description="Нажмите «Показать ещё», чтобы повторить." />
        <B24Button v-if="more && !loading" color="air-tertiary" block label="Показать ещё" @click="loadMore" />
        <!-- Каталог грузится только в браузере: на сервере статус «idle», в браузере при гидрации — «pending»;
             экран загрузки в обоих случаях, иначе разметка расходится. -->
        <BuildLoader v-if="(status === 'idle' || status === 'pending') && !extra.length" />
        <BuildLoader v-else-if="loading" compact title="Загружаем ещё товары…" />
      </B24Container>

    <component :is="FilterPanel" v-model:open="filtersOpen" title="Фильтры" v-bind="panelProps">
      <template #body>
        <div class="mx-auto flex w-full max-w-xl flex-col gap-4 pb-4">
          <B24FormField label="Бренды" description="Можно выбрать несколько">
            <B24SelectMenu
              :model-value="filters.brand"
              :items="brandItems"
              value-key="value"
              multiple
              placeholder="Все бренды"
              :search-input="{ placeholder: 'Найти бренд…' }"
              class="w-full"
              @update:model-value="v => setFilters({ brand: brandsOf(v) })"
            />
          </B24FormField>
          <B24FormField label="Сортировка">
            <B24Select :model-value="filters.sort" :items="sortItems" class="w-full" @update:model-value="v => setFilters({ sort: parseSort(v) })" />
          </B24FormField>
          <div class="flex gap-2">
            <B24Button color="air-tertiary" label="Сбросить" class="flex-1 justify-center" @click="reset" />
            <B24Button color="air-primary" :label="`Показать ${total}`" class="flex-1 justify-center" @click="filtersOpen = false" />
          </div>
        </div>
      </template>
    </component>
  </AppPage>
</template>
