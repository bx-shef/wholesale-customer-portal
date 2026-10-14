<!-- Шапка кабинета: название компании, разделы на десктопе, выход. Заодно привязывает корзину к компании. -->
<script setup lang="ts">
const props = defineProps<{ title?: string, back?: string }>()
const headers = useRequestHeaders(['cookie'])
const { data: me } = await useFetch('/api/auth/me', { headers, key: 'me' })
const cart = useCart()
const ai = useAiChat()
onMounted(() => {
  if (me.value) cart.load(me.value.company.id)
})
watch(me, (v) => {
  if (v) cart.load(v.company.id)
})

// Длинное название товара не должно наезжать на меню шапки.
const shortTitle = computed(() => {
  const t = props.title || me.value?.company.title || 'Личный кабинет'
  return t.length > 40 ? `${t.slice(0, 38)}…` : t
})

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  cart.forget()
  await navigateTo('/login')
}
</script>

<template>
  <B24Header :title="shortTitle" :to="props.back">
    <template #right>
      <div v-if="me" class="hidden md:flex gap-2">
        <B24Button to="/" color="air-tertiary" label="Каталог" />
        <B24Button :color="ai.open.value ? 'air-primary' : 'air-tertiary'" label="Помощник" @click="ai.toggle()" />
        <B24Button to="/cart" color="air-tertiary" :label="cart.count.value ? `Корзина · ${cart.count.value}` : 'Корзина'" />
        <B24Button to="/orders" color="air-tertiary" label="Заявки" />
        <B24Button to="/profile" color="air-tertiary" label="Профиль" />
        <B24Button color="air-tertiary" label="Выйти" @click="logout" />
      </div>
    </template>
  </B24Header>
</template>
