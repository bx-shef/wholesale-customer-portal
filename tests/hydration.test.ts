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
      expect(src, f).not.toMatch(/ref\(\s*Math\.(floor\()?\s*Math\.random/)
      expect(src, f).not.toMatch(/ref\(Math\.floor\(Math\.random/)
      expect(src, f).not.toMatch(/import\.meta\.client \? window\.location/)
    }
  })

  it('BuildLoader выбирает подсказку только после монтирования', () => {
    const src = readFileSync(join(root, 'components/BuildLoader.vue'), 'utf8')
    expect(src).toContain('const tip = ref(0)')
    expect(src).toMatch(/onMounted\(\(\) => \{\s*tip\.value = Math\.floor\(Math\.random\(\)/)
  })
})
