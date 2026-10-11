import { describe, expect, it } from 'vitest'
import { readServerEnv } from '../server/utils/env'

describe('readServerEnv', () => {
  it('мок 1С включён по умолчанию и выключается только явным false', () => {
    expect(readServerEnv({}).onecMock).toBe(true)
    expect(readServerEnv({ ONEC_MOCK: 'FALSE ' }).onecMock).toBe(false)
    expect(readServerEnv({ ONEC_MOCK: '0' }).onecMock).toBe(true)
  })
  it('читает имена без префикса NUXT_ и обрезает пробелы', () => {
    expect(readServerEnv({ MCP_ADMIN_TOKEN: ' t ' }).mcpAdminToken).toBe('t')
    expect(readServerEnv({ NUXT_MCP_ADMIN_TOKEN: 't' }).mcpAdminToken).toBe('')
  })
  it('модель DeepSeek по умолчанию', () => {
    expect(readServerEnv({}).deepseekModel).toBe('deepseek-chat')
  })
})
