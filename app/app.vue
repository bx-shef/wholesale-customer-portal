<!-- Оболочка: Bitrix24 UI (B24App) с русской локалью, как в bx-shef/skills-site. -->
<script setup lang="ts">
import { ru } from '@bitrix24/b24ui-nuxt/locale'

// Тема b24ui включается только вызовом композабла: он ставит класс light/dark на <html>
// (как в bx-shef/skills-site, где его зовёт шапка). Без вызова тёмная тема не включалась.
useColorMode()
</script>

<template>
  <B24App :locale="ru">
    <NuxtLoadingIndicator color="#0075ff" />
    <NuxtPage />
  </B24App>
</template>
