<!-- Шапка кабинета: название компании, разделы (на телефоне — в меню-бургере), выход. Заодно привязывает корзину к компании. -->
<script setup lang="ts">
const props = defineProps<{ title?: string, back?: string }>()
const headers = useRequestHeaders(['cookie'])
const { data: me } = await useFetch('/api/auth/me', { headers, key: 'me' })
const cart = useCart()
const ai = useAiChat()
const menuOpen = ref(false)
const route = useRoute()
watch(() => route.fullPath, () => { menuOpen.value = false })
const links = [
  { to: '/', label: 'Каталог' },
  { to: '/cart', label: 'Корзина' },
  { to: '/orders', label: 'Заявки' },
  { to: '/profile', label: 'Профиль' },
  { to: '/help', label: 'Справка' },
]
function openAi() {
  menuOpen.value = false
  ai.toggle()
}
onMounted(() => {
  if (me.value) {
    cart.load(me.value.company.id)
    setCacheCompany(me.value.company.id)
  }
})
watch(me, (v) => {
  if (v) {
    cart.load(v.company.id)
    setCacheCompany(v.company.id)
  }
})

// Длинное название товара не должно наезжать на меню шапки.
const shortTitle = computed(() => {
  const t = props.title || me.value?.company.title || 'Личный кабинет'
  return t.length > 40 ? `${t.slice(0, 38)}…` : t
})

const logoutError = ref('')
async function logout() {
  logoutError.value = ''
  // Сохранённое с устройства уходит в любом случае.
  cart.forget()
  // Поиск и фильтры прежнего пользователя на общем устройстве не оставляем.
  try { localStorage.removeItem('wcp-catalog-filters') } catch {}
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
  await navigateTo('/login')
}
</script>

<template>
  <B24Header v-model:open="menuOpen" :title="shortTitle" :to="props.back">
    <template #title>
      <!-- Ширина заголовка ограничена: длинное название товара раздувало страницу на телефоне до 494 px (#77). -->
      <span class="flex min-w-0 max-w-[calc(100vw-8rem)] md:max-w-md items-center gap-3 overflow-hidden">
        <img src="/logo.png" alt="Алгена" class="h-7 w-auto shrink-0">
        <span class="min-w-0 truncate">{{ shortTitle }}</span>
      </span>
    </template>
    <template #right>
      <div v-if="me" class="hidden md:flex gap-2">
        <B24Button to="/" color="air-tertiary" label="Каталог" />
        <B24Button :color="ai.open.value ? 'air-primary' : 'air-tertiary'" label="Помощник" @click="ai.toggle()" />
        <B24Button to="/cart" color="air-tertiary" :label="cart.count.value ? `Корзина · ${cart.count.value}` : 'Корзина'" />
        <B24Button to="/orders" color="air-tertiary" label="Заявки" />
        <B24Button to="/profile" color="air-tertiary" label="Профиль" />
        <B24Button to="/help" color="air-tertiary" label="Справка" />
        <B24Button color="air-tertiary" label="Выйти" @click="logout" />
      </div>
    </template>
    <template #body>
      <nav v-if="me" class="flex flex-col gap-1" aria-label="Разделы">
        <B24Button v-for="l in links" :key="l.to" :to="l.to" color="air-tertiary" block class="justify-start" :label="l.to === '/cart' && cart.count.value ? `Корзина · ${cart.count.value}` : l.label" />
        <B24Button color="air-tertiary" block class="justify-start" label="ИИ-помощник" @click="openAi" />
        <B24Button color="air-tertiary" block class="justify-start" label="Выйти" @click="logout" />
      </nav>
    </template>
  </B24Header>
  <B24Alert v-if="logoutError" color="air-primary-alert" :title="logoutError" class="rounded-none" />
</template>