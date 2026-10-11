import { defineConfig } from 'vitest/config'

// Юнит-тесты чистых функций в node.
export default defineConfig({
  test: {
    name: 'unit',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
