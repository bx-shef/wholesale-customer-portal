<!-- Карточка товара: цена договора, кратность, остатки по складам, свойства, аналоги. -->
<script setup lang="ts">
import type { CatalogItemDetailsView, PriceStatus } from '~~/shared/catalogView'
import { missingPriceText } from '~~/shared/catalogView'
import { normalizeQty } from '~~/shared/cart'

const route = useRoute()
const headers = useRequestHeaders(['cookie'])

const { data, error } = await useFetch<{ item: CatalogItemDetailsView, priceStatus: PriceStatus }>(() => `/api/catalog/${route.params.guid}`, { headers })
if (error.value?.statusCode === 401) await navigateTo('/login')
useHead({ title: () => data.value?.item.name ?? 'Товар' })

const item = computed(() => data.value?.item)
const cart = useCart()
const inCart = computed(() => (item.value ? cart.qtyOf(item.value.guid) : 0))
</script>

<template>
  <div class="pb-16 md:pb-0">
    <AppHeader :title="item?.name || 'Товар'" back="/" />
    <B24Main>
      <B24Container class="py-4 flex flex-col gap-4 max-w-2xl">
        <B24Alert v-if="error?.statusCode === 404" color="air-primary-warning" title="Товар не найден" description="Его могли убрать из каталога. Вернитесь в каталог и найдите похожий." />
        <B24Alert v-else-if="error && error.statusCode !== 401" color="air-primary-alert" title="Не удалось загрузить товар. Обновите страницу." />
        <template v-else-if="item">
          <B24Card>
            <div class="flex flex-col gap-2">
              <div v-if="item.images.length" class="flex gap-2 overflow-x-auto">
                <img v-for="src in item.images" :key="src" :src="src" :alt="item.name" onerror="this.remove()" class="h-48 max-w-full shrink-0 rounded object-contain bg-white">
              </div>
              <h1 class="text-lg font-semibold leading-snug">
                {{ item.name }}
              </h1>
              <p class="text-sm text-(--ui-color-design-plain-na-content-secondary)">
                Артикул {{ item.sku }} · {{ item.brand }}
              </p>
              <p class="text-2xl font-semibold">
                <template v-if="item.price">
                  {{ formatMoney(item.price.value, item.price.currency) }}<span class="text-sm font-normal"> / {{ item.unit }}, НДС {{ item.price.vatRate }}%</span>
                </template>
                <span v-else class="text-base font-normal">{{ missingPriceText(data?.priceStatus ?? 'ok') }}</span>
              </p>
              <StockBadge :available="item.available" :unit="item.unit" class="self-start" />
              <div v-if="item.price" class="flex flex-wrap items-center gap-3 pt-2">
                <B24Button v-if="!inCart" color="air-primary" label="В корзину" class="min-h-11" @click="cart.setQty(item.guid, normalizeQty(item.minQty, item.packQty, item.minQty))" />
                <template v-else>
                  <QtyStepper :qty="inCart" :pack-qty="item.packQty" :min-qty="item.minQty" :unit="item.unit" @update:qty="v => cart.setQty(item!.guid, v)" />
                  <B24Button to="/cart" color="air-tertiary" label="Перейти в корзину" />
                </template>
              </div>
              <p class="text-sm">
                Кратность: {{ formatQty(item.packQty, item.unit) }}<template v-if="item.minQty > item.packQty">
                  , минимум {{ formatQty(item.minQty, item.unit) }}
                </template>
              </p>
            </div>
          </B24Card>

          <B24Card v-if="item.stock.length">
            <template #header>
              <h2 class="font-semibold">
                Остатки по складам
              </h2>
            </template>
            <dl class="grid grid-cols-2 gap-2 text-sm">
              <template v-for="s in item.stock" :key="s.warehouseGuid">
                <dt>{{ s.warehouseName }}</dt><dd>{{ formatQty(s.available, item.unit) }}</dd>
              </template>
            </dl>
          </B24Card>

          <B24Card v-if="item.description || Object.keys(item.properties).length">
            <template #header>
              <h2 class="font-semibold">
                Описание
              </h2>
            </template>
            <p v-if="item.description" class="text-sm mb-3">
              {{ item.description }}
            </p>
            <dl class="grid grid-cols-2 gap-2 text-sm">
              <template v-for="(v, k) in item.properties" :key="k">
                <dt>{{ k }}</dt><dd>{{ v }}</dd>
              </template>
            </dl>
          </B24Card>

          <section v-if="item.analogs.length" class="flex flex-col gap-2">
            <h2 class="font-semibold">
              Аналоги
            </h2>
            <NuxtLink v-for="a in item.analogs" :key="a.guid" :to="`/product/${a.guid}`">
              <B24Card>
                <div class="flex items-center justify-between gap-2">
                  <div>
                    <p class="font-medium">
                      {{ a.name }}
                    </p>
                    <p class="text-xs text-(--ui-color-design-plain-na-content-secondary)">
                      {{ a.sku }} · {{ a.brand }}
                    </p>
                  </div>
                  <div class="text-right">
                    <p class="font-semibold">
                      {{ a.price ? formatMoney(a.price.value, a.price.currency) : '—' }}
                    </p>
                    <StockBadge :available="a.available" :unit="a.unit" />
                  </div>
                </div>
              </B24Card>
            </NuxtLink>
          </section>
        </template>
      </B24Container>
    </B24Main>
    <BottomNav />
  </div>
</template>
