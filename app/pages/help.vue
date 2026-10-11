<!-- Справка из Nuxt Content (коллекция help). -->
<script setup lang="ts">
const { data: page } = await useAsyncData('help-index', () => queryCollection('help').path('/help').first())
useHead({ title: 'Справка' })
</script>

<template>
  <div>
  <B24Header title="Справка" />
  <B24Main>
    <B24Container class="py-8">
      <ContentRenderer v-if="page" :value="page" />
      <B24Empty v-else title="Справка пока пуста" />
    </B24Container>
  </B24Main>
  </div>
</template>
