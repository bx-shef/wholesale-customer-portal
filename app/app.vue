<!-- Оболочка: Bitrix24 UI (B24App) с русской локалью, как в bx-shef/skills-site. -->
<script setup lang="ts">
import { ru } from '@bitrix24/b24ui-nuxt/locale'

// Тема b24ui включается только вызовом композабла: он ставит класс light/dark на <html>
// (как в bx-shef/skills-site, где его зовёт шапка). Без вызова тёмная тема не включалась.
useColorMode()
const { open: aiOpen } = useAiChat()
// Помощник выключен на сервере (`AI_ASSISTANT`) — панели нет вовсе.
const { data: me } = useNuxtData<{ ai?: boolean }>('me')
const online = useOnline()
onMounted(registerServiceWorker)

// Превью ссылки в мессенджерах: картинка — абсолютным адресом этого же сайта (public/og.png,
// scripts/make-brand.mjs). Адрес берём из запроса — один образ на любой домен.
const origin = useState('site-origin', () => useRequestURL({ xForwardedHost: true, xForwardedProto: true }).origin)
const ogTitle = 'Личный кабинет оптового покупателя — Алгена'
const ogDescription = 'Каталог с вашими ценами и остатками, заявка и дата доставки.'
useSeoMeta({
  description: ogDescription,
  ogTitle,
  ogDescription,
  ogType: 'website',
  ogImage: () => `${origin.value}/og.png`,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  twitterCard: 'summary_large_image',
})
</script>

<template>
  <B24App :locale="ru">
    <NuxtLoadingIndicator color="#0075ff" />
    <!-- Открытый чат на компьютере сдвигает страницу влево: без меню — эта обёртка, в кабинете — раскладка (fixed). -->
    <div class="ai-shell" :class="{ 'ai-shell--chat': aiOpen }">
      <B24Alert
        v-if="!online"
        color="air-primary-warning"
        title="Нет сети: открыто сохранённое ранее, цены и остатки могли измениться. Заявку отправьте, когда сеть вернётся."
        class="rounded-none"
      />
      <ClientDataGate>
        <NuxtLayout>
          <NuxtPage />
        </NuxtLayout>
      </ClientDataGate>
    </div>
    <ClientOnly v-if="me?.ai">
      <AiChatPanel />
    </ClientOnly>
  </B24App>
</template>
