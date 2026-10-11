<!-- Пустой ЛК этапа 0: каталог появится на этапе 3, вход — на этапе 2 (docs/plan.md). -->
<script setup lang="ts">
import ProductIcon from '@bitrix24/b24icons-vue/outline/ProductIcon'

useHead({ title: 'Каталог' })
</script>

<template>
  <div>
  <B24Header title="Личный кабинет" />
  <B24Main>
    <B24Container class="py-8">
      <B24Empty
        :icon="ProductIcon"
        title="Каталог скоро появится"
        description="Здесь будут товары с вашей ценой и остатками, корзина и заявки."
      />
    </B24Container>
  </B24Main>
  </div>
</template>
