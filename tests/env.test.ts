import { describe, expect, it } from 'vitest'
import { readServerEnv } from '../server/utils/env'

describe('readServerEnv', () => {
  it('мок 1С — только при явном true; пусто, 0, false — реальная 1С', () => {
    expect(readServerEnv({ ONEC_MOCK: 'TRUE ' }).onecMock).toBe(true)
    expect(readServerEnv({}).onecMock).toBe(false)
    expect(readServerEnv({ ONEC_MOCK: '0' }).onecMock).toBe(false)
    expect(readServerEnv({ ONEC_MOCK: 'false' }).onecMock).toBe(false)
  })
  it('читает имена без префикса NUXT_ и обрезает пробелы', () => {
    expect(readServerEnv({ MCP_ADMIN_TOKEN: ' t ' }).mcpAdminToken).toBe('t')
    expect(readServerEnv({ NUXT_MCP_ADMIN_TOKEN: 't' }).mcpAdminToken).toBe('')
  })
  it('модель DeepSeek по умолчанию', () => {
  })
})
