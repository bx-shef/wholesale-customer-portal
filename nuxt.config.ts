// Каркас ЛК (docs/plan.md, этап 0). Интерфейс — только Bitrix24 UI, Nuxt UI не подключаем.
// Конфигурация — окружением при запуске (.env.example), один образ на любой сервер (docs/DEPLOY.md).
export default defineNuxtConfig({
  modules: ['@bitrix24/b24ui-nuxt', '@nuxt/content', '@nuxtjs/mcp-toolkit', '@nuxt/eslint'],
  compatibilityDate: '2026-09-01',
  devtools: { enabled: false },

  css: ['~/assets/css/main.css'],

  // Тема: модуль подключает компоненты переключения, сам режим — app/app.config.ts + useColorMode().
  b24ui: { colorMode: true },

  app: {
    head: {
      htmlAttrs: { lang: 'ru' },
      title: 'Личный кабинет',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        // Кабинет закрытый: в поиск не нужен ни сейчас, ни после запуска.
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        // PWA: установка на телефон и каталог без сети (public/sw.js, app/composables/usePwa.ts).
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: '/icon-192.png' },
      ],
    },
  },

  content: {
    // Встроенный node:sqlite (Node 22.5+) — без нативной сборки better-sqlite3 в образе.
    experimental: { sqliteConnector: 'native' },
    // В проде контейнер read_only (docker-compose.prod.yml), писать можно только в tmpfs /tmp.
    // База справки собирается из дампа при старте, поэтому её потеря при рестарте ничего не стоит.
    database: { type: 'sqlite', filename: '/tmp/wholesale-content.sqlite' },
  },

  mcp: {
    name: 'wholesale-customer-portal',
    version: '0.0.0',
    // Обработчики — server/mcp/handlers/{client,admin}: /mcp/client и /mcp/admin.
    // Явно: общий /mcp без проверки видит только инструменты вне именованных обработчиков (их нет).
    // При 'all' он отдал бы onec_* без токена — CI проверяет, что /mcp пуст.
    defaultHandlerStrategy: 'orphans',
  },

  nitro: {
    preset: 'node-server',
    // Обмены по расписанию (docs/spec.md §4); задача сама молчит без B24_WEBHOOK_URL.
    experimental: { tasks: true },
    scheduledTasks: {
      '*/10 * * * *': ['sync:clients'],
      '*/5 * * * *': ['sync:stock'],
      '3-59/15 * * * *': ['sync:prices'],
      '1-59/5 * * * *': ['monitor:alerts'],
      '*/2 * * * *': ['sync:orders'],
      '7 * * * *': ['sync:catalog'],
      '13 * * * *': ['sync:schedule'],
      '4-59/10 * * * *': ['sync:trips'],
      '17 3 * * *': ['maintenance:prune'],
    },
    routeRules: {
      '/**': { headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
      // Воркер и манифест — без кэша браузера: иначе исправленный sw.js доходит до клиентов с опозданием.
      '/sw.js': { headers: { 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow' } },
      '/manifest.webmanifest': { headers: { 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow' } },
    },
  },

  eslint: {
    config: { stylistic: false },
  },
})
