<!-- Каталог: поиск, фильтры в шторке, подгрузка при прокрутке, цены договора клиента. Состояние — в адресе. -->
<script setup lang="ts">
import ProductIcon from '@bitrix24/b24icons-vue/outline/ProductIcon'
import type { CatalogItemView, CatalogPageView } from '~~/shared/catalogView'

useHead({ title: 'Каталог' })

const PAGE = 30
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
onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}') as Record<string, string>
    if (Object.keys(route.query).length === 0 && Object.keys(saved).length > 0) router.replace({ query: saved })
  }
  catch { /* хранилище недоступно — каталог просто без сохранённых фильтров */ }
  watch(filters, (f) => {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(filtersToQuery({ ...f, sort: 'name' })))
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

const filtersOpen = ref(false)
const sectionItems = computed(() => [{ label: 'Все разделы', value: '' }, ...(options.value?.sections ?? []).map(s => ({ label: s.name, value: s.guid }))])
const brandItems = computed(() => [{ label: 'Все бренды', value: '' }, ...(options.value?.brands ?? []).map(b => ({ label: b, value: b }))])
const sectionName = computed(() => options.value?.sections.find(s => s.guid === filters.value.section)?.name)
const activeCount = computed(() => [filters.value.section, filters.value.brand, filters.value.inStock].filter(Boolean).length)

function reset() {
  search.value = ''
  router.push({ query: {} })
}

</script>

<template>
  <div>
    <AppHeader />
    <B24Main>
      <B24Container class="py-4 flex flex-col gap-3">
        <!-- Поиск и фильтры прилипают под шапкой: при прокрутке длинного каталога они под рукой. -->
        <div class="sticky top-(--b24ui-header-height) z-10 -mx-4 flex gap-2 bg-(--ui-color-bg-content-secondary) px-4 py-2 sm:-mx-6 sm:px-6">
          <B24Input v-model="search" type="search" placeholder="Название или артикул" class="flex-1" aria-label="Поиск по каталогу" />
          <B24Button color="air-secondary" :label="activeCount ? `Фильтры · ${activeCount}` : 'Фильтры'" @click="filtersOpen = true" />
        </div>

        <div v-if="activeCount" class="flex flex-wrap gap-2">
          <B24Button v-if="sectionName" size="sm" color="air-secondary-accent" :label="`${sectionName} ✕`" :aria-label="`Убрать фильтр: ${sectionName}`" @click="setFilters({ section: '' })" />
          <B24Button v-if="filters.brand" size="sm" color="air-secondary-accent" :label="`${filters.brand} ✕`" :aria-label="`Убрать фильтр: ${filters.brand}`" @click="setFilters({ brand: '' })" />
          <B24Button v-if="filters.inStock" size="sm" color="air-secondary-accent" label="В наличии ✕" aria-label="Убрать фильтр: в наличии" @click="setFilters({ inStock: false })" />
        </div>

        <B24Alert v-if="priceStatus === 'unavailable'" color="air-primary-warning" title="Цены временно недоступны" description="Каталог и остатки показываем, цены появятся, как только ответит учётная система. Обновите страницу через минуту." />
        <B24Alert v-else-if="priceStatus === 'no-contract'" color="air-primary-warning" title="Цены пока не подключены" description="Ваша компания ещё не связана с договором в учётной системе. Обратитесь к менеджеру — после подключения цены появятся здесь." />
        <B24Alert v-if="firstError && firstError.statusCode !== 401" color="air-primary-alert" title="Не удалось загрузить каталог" description="Проверьте связь и обновите страницу." />

        <p v-if="items.length" class="text-sm text-(--ui-color-design-plain-na-content-secondary)">
          Найдено: {{ total }}
        </p>

        <B24Empty
          v-if="!loading && !firstError && items.length === 0"
          :icon="ProductIcon"
          title="Ничего не нашлось"
          :description="filters.q || activeCount ? 'Измените запрос или сбросьте фильтры.' : 'Каталог ещё загружается из учётной системы. Обновите страницу через пару минут.'"
          :actions="filters.q || activeCount ? [{ label: 'Сбросить', onClick: reset }] : []"
        />

        <ul class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <li v-for="it in items" :key="it.guid">
            <NuxtLink :to="`/product/${it.guid}`" class="block h-full">
              <B24Card class="h-full">
                <div class="flex gap-3">
                  <img v-if="it.image" :src="it.image" alt="" onerror="this.remove()" loading="lazy" class="size-16 shrink-0 rounded object-contain bg-white">
                  <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <p class="font-medium leading-snug">
                    {{ it.name }}
                  </p>
                  <p class="text-xs text-(--ui-color-design-plain-na-content-secondary)">
                    {{ it.sku }} · {{ it.brand }}
                  </p>
                  <div class="flex items-center justify-between gap-2 pt-1">
                    <span class="font-semibold">{{ it.price ? formatMoney(it.price.value, it.price.currency) : '—' }}<span class="text-xs font-normal"> / {{ it.unit }}</span></span>
                    <StockBadge :available="it.available" :unit="it.unit" />
                  </div>
                  </div>
                </div>
              </B24Card>
            </NuxtLink>
          </li>
        </ul>

        <div ref="sentinel" />
        <B24Alert v-if="moreFailed" color="air-primary-alert" title="Не удалось загрузить следующие товары" description="Нажмите «Показать ещё», чтобы повторить." />
        <B24Button v-if="more && !loading" color="air-tertiary" block label="Показать ещё" @click="loadMore" />
        <BuildLoader v-if="status === 'pending' && !extra.length" />
        <BuildLoader v-else-if="loading" compact title="Загружаем ещё товары…" />
      </B24Container>
    </B24Main>

    <B24Drawer v-model:open="filtersOpen" title="Фильтры" direction="bottom" handle>
      <template #body>
        <div class="mx-auto flex w-full max-w-xl flex-col gap-4 pb-4">
          <B24FormField label="Раздел">
            <B24Select :model-value="filters.section" :items="sectionItems" class="w-full" @update:model-value="v => setFilters({ section: String(v ?? '') })" />
          </B24FormField>
          <B24FormField label="Бренд">
            <B24Select :model-value="filters.brand" :items="brandItems" class="w-full" @update:model-value="v => setFilters({ brand: String(v ?? '') })" />
          </B24FormField>
          <B24Switch :model-value="filters.inStock" label="Только в наличии" @update:model-value="v => setFilters({ inStock: !!v })" />
          <div class="flex gap-2">
            <B24Button color="air-tertiary" label="Сбросить" class="flex-1 justify-center" @click="reset" />
            <B24Button color="air-primary" :label="`Показать ${total}`" class="flex-1 justify-center" @click="filtersOpen = false" />
          </div>
        </div>
      </template>
    </B24Drawer>
  </div>
</template>
