// Гидратация (#76): разметка сервера и браузера обязана совпадать. Случайное значение или адрес
// из `window` при отрисовке дают «Hydration completed but contains mismatches» (замер: /b24/app
// до правки — ошибка, после — нет, Chromium 2026-10-22).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..', 'app')
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.vue') ? [p] : []
})

describe('гидратация: одинаковая разметка на сервере и в браузере', () => {
  it('случайное число и адрес из window не задают начальное состояние компонента', () => {
    for (const f of files(root)) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/ref\(Math\.floor\(Math\.random/)
      expect(src, f).not.toMatch(/import\.meta\.client \? window\.location/)
      // Дата без пояса: сервер в UTC, браузер в поясе клиента — около полуночи разные дни.
      expect(src, f).not.toMatch(/toLocale(Date|Time)?String\('ru-RU'\)/)
    }
  })

  it('BuildLoader выбирает подсказку только после монтирования', () => {
    const src = readFileSync(join(root, 'components/BuildLoader.vue'), 'utf8')
    expect(src).toContain('const tip = ref(0)')
    expect(src).toMatch(/onMounted\(\(\) => \{\s*tip\.value = Math\.floor\(Math\.random\(\)/)
  })
})

describe('каталог: загрузка только в браузере не расходится при гидрации', () => {
  const page = readFileSync(join(__dirname, '../app/pages/index.vue'), 'utf8')
  it('экран загрузки и на сервере («idle»), и в браузере («pending»); «ничего не нашлось» — только после ответа', () => {
    expect(page).toContain("status === 'idle' || status === 'pending'")
    expect(page).toMatch(/<B24Empty\s+v-if="status === 'success'/)
  })
})

describe('мок: исправленные товары доходят до заполненного индекса', () => {
  it('момент изменения сгенерированных товаров позже витринных (курсор синхронизации)', async () => {
    const { generateSeed } = await import('../server/mocks/onec/seed')
    const items = generateSeed(1).items
    const demo = items.filter(i => !i.name.includes(':')).map(i => i.changedAt).sort().at(-1)!
    for (const i of items.filter(i => i.name.includes(':'))) expect(i.changedAt > demo).toBe(true)
  })
})
