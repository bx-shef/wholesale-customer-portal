import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Юнит-тесты чистых функций в node.
export default defineConfig({
  // `~~` — корень, как в Nuxt: app/utils/format.ts тянет shared так (относительный путь ломает сборку сервера).
  resolve: { alias: { '~~': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    name: 'unit',
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/contract/**/*.spec.ts'],
  },
})
