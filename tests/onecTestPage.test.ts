import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { ONEC_TEST_PAGE } from '../server/utils/onecTestPage'

describe('страница стенда 1С', () => {
  it('скрипт страницы разбирается: ошибка синтаксиса гасит весь стенд (2026-10-21)', () => {
    const scripts = [...ONEC_TEST_PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]!)
    expect(scripts.length).toBeGreaterThan(0)
    for (const code of scripts) expect(() => new Script(code)).not.toThrow()
  })
})
