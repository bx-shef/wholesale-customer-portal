import { defineCollection, defineContentConfig } from '@nuxt/content'

// Справка ЛК (публичная часть docs → справка и ИИ-чат, по образцу toolsai/invoice-from-tasks).
export default defineContentConfig({
  collections: {
    help: defineCollection({ type: 'page', source: 'help/**/*.md' }),
  },
})
