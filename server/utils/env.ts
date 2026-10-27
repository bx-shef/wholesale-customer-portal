/**
 * Окружение сервера — одна точка чтения. Имена — как в .env.example и docs/plan.md, без
 * префикса NUXT_: runtimeConfig Nuxt подхватывает при запуске только NUXT_*, а значения без
 * префикса запёк бы в образ на сборке. Читаем при каждом вызове — образ один на все серверы.
 */
import { everyFromEnv, type AutoFlow } from './syncSchedule'

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
  /** Сколько минут данные клиента из 1С считаются свежими при входе (`ONEC_CLIENT_TTL_MIN`, по умолчанию 15). */
  onecClientTtlMin: number
  /** Склады для остатков клиенту по OData, через запятую; пусто — «Основной склад». */
  onecStockWarehouses: string[]
  /** OData: заказы ЛК → документы 1С и их статусы (`ONEC_ODATA_ORDERS=true`); иначе поток заказов пропускается. */
  onecOdataOrders: boolean
  /** OData: рейсы из «Заданий на перевозку» (`ONEC_ODATA_TRIPS=true`); иначе поток рейсов пропускается. */
  onecOdataTrips: boolean
  /** OData: картинки товаров (`ONEC_ODATA_IMAGES=true`); 1С отдаёт файлы пустыми — выключено до ответа 1С. */
  onecOdataImages: boolean
  /** Транспорт 1С: `http` — сервис по контракту, `odata` — стандартный OData (docs/onec-odata.md). */
  onecMode: 'http' | 'odata'
  /** Виды цен по наименованию для OData, через запятую; пусто — все. */
  onecPriceTypes: string[]
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
  /** Частота автосинхронизации по потокам, минут (`SYNC_*_EVERY_MIN`, 0 — только вручную). */
  syncEvery: Record<AutoFlow, number>
  /** Разделы 1С, скрытые от клиентов вместе с товарами (`CATALOG_HIDDEN_SECTIONS`, названия через запятую). */
  catalogHiddenSections: string[]
  /** Характеристики, которые клиенту не показываем (`CATALOG_HIDDEN_PROPERTIES`, названия через запятую). */
  catalogHiddenProperties: string[]
  /** Картинок за прогон потока `images` (`SYNC_IMAGES_BATCH`, 1–5000, по умолчанию 1000). */
  imagesBatch: number
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
    // Клиенты 1С по OData уходят в компании Б24: включаются отдельно, после проверки стендом (PR #63).
    // Заказы ЛК пишутся в 1С: включаются отдельно, после проверки стендом на тестовой базе.
    onecOdataOrders: get('ONEC_ODATA_ORDERS').trim().toLowerCase() === 'true',
    // Рейсы: документ «Задание на перевозку» выпал из публикации OData — включать, когда вернут.
    onecOdataTrips: get('ONEC_ODATA_TRIPS').trim().toLowerCase() === 'true',
    onecOdataImages: get('ONEC_ODATA_IMAGES').trim().toLowerCase() === 'true',
    onecPriceTypes: get('ONEC_PRICE_TYPES').split(',').map(s => s.trim()).filter(Boolean),
    onecStockWarehouses: get('ONEC_STOCK_WAREHOUSES').split(',').map(s => s.trim()).filter(Boolean),
    onecClientTtlMin: (n => (Number.isInteger(n) && n >= 1 && n <= 1440 ? n : 15))(Number(get('ONEC_CLIENT_TTL_MIN') || 15)),
    onecMockClients: get('ONEC_MOCK_CLIENTS').split(',').map(s => s.trim().toLowerCase()).filter(s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)),
    sessionSecret: get('SESSION_SECRET'),
    mcpAdminToken: get('MCP_ADMIN_TOKEN'),
    onecTestPassword: get('ONEC_TEST_PASSWORD'),
    onecTestLogin: get('ONEC_TEST_LOGIN'),
    publicUrl: get('PUBLIC_URL').replace(/\/+$/, ''),
    commitSha: get('COMMIT_SHA'),
    syncEvery: everyFromEnv(get),
    catalogHiddenProperties: get('CATALOG_HIDDEN_PROPERTIES').split(',').map(s => s.trim()).filter(Boolean),
    catalogHiddenSections: get('CATALOG_HIDDEN_SECTIONS').split(',').map(s => s.trim()).filter(Boolean),
    imagesBatch: (n => (Number.isInteger(n) && n >= 1 && n <= 5000 ? n : 1000))(Number(get('SYNC_IMAGES_BATCH') || 1000)),
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
