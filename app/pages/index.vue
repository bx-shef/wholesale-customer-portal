<!-- Каталог: поиск, фильтры в шторке, подгрузка при прокрутке, цены договора клиента. Состояние — в адресе. -->
<script setup lang="ts">
import ProductIcon from '@bitrix24/b24icons-vue/outline/ProductIcon'

useHead({ title: 'Каталог' })

interface Priced {
  guid: string
  sku: string
  name: string
  brand: string
  unit: string
  packQty: number
  minQty: number
  available: number
  price: { value: number, currency: string } | null
}
interface Page { items: Priced[], total: number, pricesAvailable: boolean }

const PAGE = 30
const route = useRoute()
const router = useRouter()
const headers = useRequestHeaders(['cookie'])

const { data: me, error: meError } = await useFetch('/api/auth/me', { headers })
if (meError.value?.statusCode === 401) await navigateTo('/login')

const filters = ref(filtersFromQuery(route.query))
const search = ref(filters.value.q)
const filtersOpen = ref(false)

const { data: options } = await useFetch('/api/catalog/filters', { headers })
const sectionName = computed(() => options.value?.sections.find(s => s.guid === filters.value.section)?.name)

const items = ref<Priced[]>([])
const total = ref(0)
const pricesAvailable = ref(true)
const loading = ref(false)
const failed = ref(false)

async function load(reset: boolean) {
  if (loading.value) return
  loading.value = true
  failed.value = false
  try {
    const page = await $fetch<Page>('/api/catalog', {
      headers,
      query: { ...filtersToQuery(filters.value), offset: reset ? 0 : items.value.length, limit: PAGE },
    })
    items.value = reset ? page.items : [...items.value, ...page.items]
    total.value = page.total
    pricesAvailable.value = page.pricesAvailable
  }
  catch (e) {
    if ((e as { statusCode?: number }).statusCode === 401) return navigateTo('/login')
    failed.value = true
  }
  finally {
    loading.value = false
  }
}
await load(true)

watch(filters, (f) => {
  router.replace({ query: filtersToQuery(f) })
  load(true)
}, { deep: true })

// Поиск — после паузы в наборе, а не на каждую букву.
let timer: ReturnType<typeof setTimeout> | undefined
watch(search, (v) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    filters.value.q = v
  }, 300)
})

const more = computed(() => items.value.length < total.value)
const sentinel = ref<HTMLElement>()
onMounted(() => {
  const io = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting) && more.value && !failed.value) load(false)
  }, { rootMargin: '400px' })
  watch(sentinel, (el, old) => {
    if (old) io.unobserve(old)
    if (el) io.observe(el)
  }, { immediate: true })
  onBeforeUnmount(() => io.disconnect())
})

const sorts = [
  { label: 'По названию', value: 'name' },
  { label: 'По артикулу', value: 'sku' },
  { label: 'Сначала в наличии', value: 'available' },
]
const sectionItems = computed(() => [{ label: 'Все разделы', value: '' }, ...(options.value?.sections ?? []).map(s => ({ label: s.name, value: s.guid }))])
const brandItems = computed(() => [{ label: 'Все бренды', value: '' }, ...(options.value?.brands ?? []).map(b => ({ label: b, value: b }))])
const activeCount = computed(() => [filters.value.section, filters.value.brand, filters.value.inStock].filter(Boolean).length)

function reset() {
  search.value = ''
  filters.value = { ...DEFAULT_FILTERS }
}

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await navigateTo('/login')
}
</script>

<template>
  <div class="pb-16 md:pb-0">
    <B24Header :title="me?.company.title || 'Каталог'">
      <template #right>
        <div v-if="me" class="hidden md:flex gap-2">
          <B24Button to="/profile" color="air-tertiary" label="Профиль" />
          <B24Button color="air-tertiary" label="Выйти" @click="logout" />
        </div>
      </template>
    </B24Header>
    <B24Main>
      <B24Container class="py-4 flex flex-col gap-3">
        <div class="flex gap-2">
          <B24Input v-model="search" type="search" placeholder="Название или артикул" class="flex-1" aria-label="Поиск по каталогу" />
          <B24Button color="air-secondary" :label="activeCount ? `Фильтры · ${activeCount}` : 'Фильтры'" @click="filtersOpen = true" />
        </div>

        <div v-if="activeCount" class="flex flex-wrap gap-2">
          <B24Button v-if="sectionName" size="sm" color="air-secondary-accent" :label="`${sectionName} ✕`" @click="filters.section = ''" />
          <B24Button v-if="filters.brand" size="sm" color="air-secondary-accent" :label="`${filters.brand} ✕`" @click="filters.brand = ''" />
          <B24Button v-if="filters.inStock" size="sm" color="air-secondary-accent" label="В наличии ✕" @click="filters.inStock = false" />
        </div>

        <B24Alert v-if="!pricesAvailable" color="air-primary-warning" title="Цены временно недоступны" description="Каталог и остатки показываем, цены появятся, как только ответит учётная система. Обновите страницу через минуту." />
        <B24Alert v-if="failed" color="air-primary-alert" title="Не удалось загрузить каталог" description="Проверьте связь и обновите страницу." />

        <p v-if="items.length" class="text-sm text-(--ui-color-design-plain-na-content-secondary)">
          Найдено: {{ total }}
        </p>

        <B24Empty
          v-if="!loading && !failed && items.length === 0"
          :icon="ProductIcon"
          title="Ничего не нашлось"
          :description="filters.q || activeCount ? 'Измените запрос или сбросьте фильтры.' : 'Каталог ещё загружается из учётной системы. Обновите страницу через пару минут.'"
          :actions="filters.q || activeCount ? [{ label: 'Сбросить', onClick: reset }] : []"
        />

        <ul class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <li v-for="it in items" :key="it.guid">
            <NuxtLink :to="`/product/${it.guid}`" class="block h-full">
              <B24Card class="h-full">
                <div class="flex flex-col gap-1">
                  <p class="font-medium leading-snug">
                    {{ it.name }}
                  </p>
                  <p class="text-xs text-(--ui-color-design-plain-na-content-secondary)">
                    {{ it.sku }} · {{ it.brand }}
                  </p>
                  <div class="flex items-center justify-between gap-2 pt-1">
                    <span class="font-semibold">{{ it.price ? formatMoney(it.price.value, it.price.currency) : '—' }}<span class="text-xs font-normal"> / {{ it.unit }}</span></span>
                    <B24Badge size="sm" :color="stockLabel(it.available, it.unit).color" :label="stockLabel(it.available, it.unit).text" />
                  </div>
                </div>
              </B24Card>
            </NuxtLink>
          </li>
        </ul>

        <div ref="sentinel" />
        <B24Button v-if="more && !loading" color="air-tertiary" block label="Показать ещё" @click="load(false)" />
        <B24Skeleton v-if="loading" class="h-20 w-full" />
      </B24Container>
    </B24Main>

    <B24Slideover v-model:open="filtersOpen" title="Фильтры" side="bottom">
      <template #body>
        <div class="flex flex-col gap-4">
          <B24FormField label="Раздел">
            <B24Select v-model="filters.section" :items="sectionItems" class="w-full" />
          </B24FormField>
          <B24FormField label="Бренд">
            <B24Select v-model="filters.brand" :items="brandItems" class="w-full" />
          </B24FormField>
          <B24FormField label="Сортировка">
            <B24Select v-model="filters.sort" :items="sorts" class="w-full" />
          </B24FormField>
          <B24Switch v-model="filters.inStock" label="Только в наличии" />
          <div class="flex gap-2">
            <B24Button color="air-tertiary" label="Сбросить" class="flex-1 justify-center" @click="reset" />
            <B24Button color="air-primary" :label="`Показать ${total}`" class="flex-1 justify-center" @click="filtersOpen = false" />
          </div>
        </div>
      </template>
    </B24Slideover>

    <BottomNav />
  </div>
</template>
