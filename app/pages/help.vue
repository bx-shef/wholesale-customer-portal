<!-- Справка из Nuxt Content (коллекция help). Открыта и без входа: раздел «Как войти» нужен тем, кто войти не может. -->
<script setup lang="ts">
const headers = useRequestHeaders(['cookie'])
const { data: me } = await useFetch('/api/auth/me', { headers, key: 'me' })
const { data: page } = await useAsyncData('help-index', () => queryCollection('help').path('/help').first())
useHead({ title: 'Справка' })
</script>

<template>
  <AppPage v-if="me" id="help" title="Справка">
    <B24Container class="py-8 max-w-2xl">
      <ContentRenderer v-if="page" :value="page" />
      <B24Empty v-else title="Справка пока пуста" />
    </B24Container>
  </AppPage>
  <div v-else>
    <PublicHeader title="Справка">
      <template #right>
        <B24Button to="/login" color="air-primary" label="Войти" />
      </template>
    </PublicHeader>
    <B24Main>
      <B24Container class="py-8 max-w-2xl">
        <ContentRenderer v-if="page" :value="page" />
        <B24Empty v-else title="Справка пока пуста" />
      </B24Container>
    </B24Main>
    <AppFooter />
  </div>
</template>
