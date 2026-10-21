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
  /** Логин и пароль пользователя 1С — вместо токена (Basic). */
  onecLogin: string
  onecPassword: string
  /**
   * Мок 1С — только при явном `ONEC_MOCK=true`. Иначе забытая строка на проде молча подменила бы
   * 1С фейковыми данными и открыла `/mock-1c` с токеном реальной 1С (находка ревью PR #2).
   */
  onecMock: boolean
  /** Мок 1С: GUID настоящих компаний CRM, которым мок выдаёт демо-договор, адрес и цены. */
  onecMockClients: string[]
  /** Склады для остатков клиенту по OData, через запятую; пусто — «Основной склад». */
  onecStockWarehouses: string[]
  /** Транспорт 1С: `http` — сервис по контракту, `odata` — стандартный OData (docs/onec-odata.md). */
  onecMode: 'http' | 'odata'
  /** Виды цен по наименованию для OData, через запятую; пусто — все. */
  onecPriceTypes: string[]
  deepseekApiKey: string
  deepseekModel: string
  sessionSecret: string
  mcpAdminToken: string
  /** Пароль стенда проверки 1С (/api/onec-test); пусто — стенд закрыт. */
  onecTestPassword: string
  /** Логин стенда проверки 1С; пусто — любой. */
  onecTestLogin: string
  /** Адрес ЛК снаружи, например https://wsp.algena.by — для ссылки в оповещениях; пусто — без ссылки. */
  publicUrl: string
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
    onecLogin: get('ONEC_LOGIN'),
    onecPassword: get('ONEC_PASSWORD'),
    onecMock: get('ONEC_MOCK').toLowerCase() === 'true',
    onecMode: parseOnecMode(get('ONEC_MODE')),
    onecPriceTypes: get('ONEC_PRICE_TYPES').split(',').map(s => s.trim()).filter(Boolean),
    onecStockWarehouses: get('ONEC_STOCK_WAREHOUSES').split(',').map(s => s.trim()).filter(Boolean),
    onecMockClients: get('ONEC_MOCK_CLIENTS').split(',').map(s => s.trim().toLowerCase()).filter(s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)),
    deepseekApiKey: get('DEEPSEEK_API_KEY'),
    deepseekModel: get('DEEPSEEK_MODEL') || 'deepseek-chat',
    sessionSecret: get('SESSION_SECRET'),
    mcpAdminToken: get('MCP_ADMIN_TOKEN'),
    onecTestPassword: get('ONEC_TEST_PASSWORD'),
    onecTestLogin: get('ONEC_TEST_LOGIN'),
    publicUrl: get('PUBLIC_URL').replace(/\/+$/, ''),
    commitSha: get('COMMIT_SHA'),
    dataDir: get('DATA_DIR') || '.data',
    trustProxy: get('TRUST_PROXY') === '1',
  }
}

/** `ONEC_MODE`: пусто или `http` — HTTP-сервис, `odata` — OData; опечатка — предупреждение, а не тихий http. */
export function parseOnecMode(raw: string): 'http' | 'odata' {
  const v = raw.trim().toLowerCase()
  if (v === 'odata') return 'odata'
  if (v && v !== 'http') console.warn(`[env] ONEC_MODE=${JSON.stringify(v.slice(0, 20))} is not http/odata — using http`)
  return 'http'
}
