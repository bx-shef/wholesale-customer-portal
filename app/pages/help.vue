<!-- Справка из Nuxt Content (коллекция help). Открыта и без входа: раздел «Как войти» нужен тем, кто войти не может. -->
<script setup lang="ts">
const headers = useRequestHeaders(['cookie'])
const { data: me } = await useFetch('/api/auth/me', { headers, key: 'me' })
const { data: page } = await useAsyncData('help-index', () => queryCollection('help').path('/help').first())
useHead({ title: 'Справка' })
</script>

<template>
  <div>
    <AppHeader v-if="me" title="Справка" back="/" />
    <B24Header v-else title="Справка">
      <template #right>
        <B24Button to="/login" color="air-primary" label="Войти" />
      </template>
    </B24Header>
    <B24Main>
      <B24Container class="py-8 max-w-2xl">
        <ContentRenderer v-if="page" :value="page" />
        <B24Empty v-else title="Справка пока пуста" />
      </B24Container>
    </B24Main>
  </div>
</template>
