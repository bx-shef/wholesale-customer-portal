/**
 * Окружение сервера — одна точка чтения. Имена — как в .env.example и docs/plan.md, без
 * префикса NUXT_: runtimeConfig Nuxt подхватывает при запуске только NUXT_*, а значения без
 * префикса запёк бы в образ на сборке. Читаем при каждом вызове — образ один на все серверы.
 */
export interface ServerEnv {
  b24WebhookUrl: string
  onecUrl: string
  onecToken: string
  /**
   * Мок 1С — только при явном `ONEC_MOCK=true`. Иначе забытая строка на проде молча подменила бы
   * 1С фейковыми данными и открыла `/mock-1c` с токеном реальной 1С (находка ревью PR #2).
   */
  onecMock: boolean
  deepseekApiKey: string
  deepseekModel: string
  sessionSecret: string
  mcpAdminToken: string
  commitSha: string
}

export function readServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const get = (key: string) => (source[key] ?? '').trim()
  return {
    b24WebhookUrl: get('B24_WEBHOOK_URL'),
    onecUrl: get('ONEC_URL'),
    onecToken: get('ONEC_TOKEN'),
    onecMock: get('ONEC_MOCK').toLowerCase() === 'true',
    deepseekApiKey: get('DEEPSEEK_API_KEY'),
    deepseekModel: get('DEEPSEEK_MODEL') || 'deepseek-chat',
    sessionSecret: get('SESSION_SECRET'),
    mcpAdminToken: get('MCP_ADMIN_TOKEN'),
    commitSha: get('COMMIT_SHA'),
  }
}
