/**
 * Окружение сервера — одна точка чтения. Имена — как в .env.example и docs/plan.md, без
 * префикса NUXT_: runtimeConfig Nuxt подхватывает при запуске только NUXT_*, а значения без
 * префикса запёк бы в образ на сборке. Читаем при каждом вызове — образ один на все серверы.
 */
export interface ServerEnv {
  /** Ключи локального приложения коробки (карточка приложения → client_id / client_secret). */
  b24ClientId: string
  b24ClientSecret: string
  /** Хост портала коробки: установка приложения и вкладка компании доверяют только ему. */
  b24PortalHosts: string
  onecUrl: string
  onecToken: string
  /**
   * Мок 1С — только при явном `ONEC_MOCK=true`. Иначе забытая строка на проде молча подменила бы
   * 1С фейковыми данными и открыла `/mock-1c` с токеном реальной 1С (находка ревью PR #2).
   */
  onecMock: boolean
  /** Мок 1С: GUID настоящих компаний CRM, которым мок выдаёт демо-договор, адрес и цены. */
  onecMockClients: string[]
  deepseekApiKey: string
  deepseekModel: string
  sessionSecret: string
  mcpAdminToken: string
  commitSha: string
  /** Каталог базы SQLite; в проде — том `/data`. */
  dataDir: string
  /** За обратным прокси (nginx-proxy): адрес клиента берём из X-Forwarded-For — для лимита входа. */
  trustProxy: boolean
}

export function readServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const get = (key: string) => (source[key] ?? '').trim()
  return {
    b24ClientId: get('B24_CLIENT_ID'),
    b24ClientSecret: get('B24_CLIENT_SECRET'),
    b24PortalHosts: get('B24_PORTAL_HOST'),
    onecUrl: get('ONEC_URL'),
    onecToken: get('ONEC_TOKEN'),
    onecMock: get('ONEC_MOCK').toLowerCase() === 'true',
    onecMockClients: get('ONEC_MOCK_CLIENTS').split(',').map(s => s.trim().toLowerCase()).filter(s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)),
    deepseekApiKey: get('DEEPSEEK_API_KEY'),
    deepseekModel: get('DEEPSEEK_MODEL') || 'deepseek-chat',
    sessionSecret: get('SESSION_SECRET'),
    mcpAdminToken: get('MCP_ADMIN_TOKEN'),
    commitSha: get('COMMIT_SHA'),
    dataDir: get('DATA_DIR') || '.data',
    trustProxy: get('TRUST_PROXY') === '1',
  }
}
