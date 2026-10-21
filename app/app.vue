<!-- Оболочка: Bitrix24 UI (B24App) с русской локалью, как в bx-shef/skills-site. -->
<script setup lang="ts">
import { ru } from '@bitrix24/b24ui-nuxt/locale'

// Тема b24ui включается только вызовом композабла: он ставит класс light/dark на <html>
// (как в bx-shef/skills-site, где его зовёт шапка). Без вызова тёмная тема не включалась.
useColorMode()
const { open: aiOpen } = useAiChat()
const online = useOnline()
onMounted(registerServiceWorker)
</script>

<template>
  <B24App :locale="ru">
    <NuxtLoadingIndicator color="#0075ff" />
    <!-- Открытый чат на компьютере сдвигает страницу влево, а не закрывает её (как в skills-site). -->
    <div class="ai-shell" :class="{ 'ai-shell--chat': aiOpen }">
      <B24Alert
        v-if="!online"
        color="air-primary-warning"
        title="Нет сети: каталог — из сохранённого, цены и остатки могли измениться. Заявку отправите, когда сеть вернётся."
        class="rounded-none"
      />
      <NuxtPage />
      <AppFooter v-if="!$route.path.startsWith('/b24')" />
    </div>
    <ClientOnly>
      <AiChatPanel />
    </ClientOnly>
  </B24App>
</template>
