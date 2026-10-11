<!-- Каталог (этап 3). Пока — кто вошёл и выход; без сессии уводит на /login. -->
<script setup lang="ts">
import ProductIcon from '@bitrix24/b24icons-vue/outline/ProductIcon'

useHead({ title: 'Каталог' })

const { data: me, error } = await useFetch('/api/auth/me', { headers: useRequestHeaders(['cookie']) })
if (error.value?.statusCode === 401) await navigateTo('/login')

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await navigateTo('/login')
}
</script>

<template>
  <div>
    <B24Header :title="me?.company.title || 'Личный кабинет'">
      <template #right>
        <div v-if="me" class="flex gap-2">
          <B24Button to="/profile" color="air-tertiary" label="Профиль" />
          <B24Button color="air-tertiary" label="Выйти" @click="logout" />
        </div>
      </template>
    </B24Header>
    <B24Main>
      <B24Container class="py-8">
        <B24Alert v-if="error && error.statusCode !== 401" color="air-primary-warning" title="Не удалось загрузить кабинет. Обновите страницу." />
        <B24Empty
          v-else
          :icon="ProductIcon"
          title="Каталог скоро появится"
          description="Здесь будут товары с вашей ценой и остатками, корзина и заявки."
        />
      </B24Container>
    </B24Main>
  </div>
</template>
