/**
 * HTTP-клиент сервиса 1С по контракту `shared/onec/schemas.ts` (паттерн `Api\AConnector` из
 * bx-shef/insync: один клиент, таймаут, повторы, журнал). Работает с любым `fetch` — с настоящим
 * против 1С и с внутрипроцессным против мока (`server/utils/onec.ts`), поэтому мок и 1С проходят
 * через один и тот же код и одни и те же проверки.
 *
 * Каждый ответ проверяется схемой: 1С, вернувшая не то, что обещал контракт, — ошибка `contract`,
 * а не тихо испорченный каталог. Токен в журнал не попадает: журнал видит метод, путь, код, время.
 */
import type { z } from 'zod'
import {
  CatalogPage, ClientsPage, DeliverySchedulePage, TripsPage, ErrorBody, ImageFile, OrderCreated, OrderRequest, OrderStatusPage,
  PricesPage, StockPage,
} from '../../shared/onec/schemas'

export type OnecErrorKind = 'http' | 'timeout' | 'network' | 'contract'

export class OnecError extends Error {
  constructor(
    readonly kind: OnecErrorKind,
    message: string,
    readonly status?: number,
    /** Код ошибки из тела ответа 1С (`{"error": ...}`), если он был. */
    readonly code?: string,
  ) {
    super(message)
    this.name = 'OnecError'
  }

  /** Повторять имеет смысл сбой связи, таймаут, 5xx, 408 и 429; прочие 4xx и нарушение контракта — нет. */
  get retryable(): boolean {
    if (this.kind === 'timeout' || this.kind === 'network') return true
    const status = this.status ?? 0
    return this.kind === 'http' && (status >= 500 || status === 408 || status === 429)
  }
}

export interface OnecLogEntry {
  method: string
  path: string
  status: number | null
  ms: number
  attempt: number
  error?: OnecErrorKind
}

/** Авторизация в 1С: Bearer-токен или логин и пароль пользователя 1С (Basic), docs/onec-contract.md §1.2. */
export type OnecAuth = { kind: 'bearer', token: string } | { kind: 'basic', login: string, password: string }

export function onecAuthHeader(auth: OnecAuth): string {
  return auth.kind === 'basic'
    ? `Basic ${Buffer.from(`${auth.login}:${auth.password}`, 'utf8').toString('base64')}`
    : `Bearer ${auth.token}`
}

export interface OnecClientOptions {
  /** База без завершающего `/`, например `https://1c.example.by/hs/lk` или `http://mock/mock-1c`. */
  baseUrl: string
  /** Bearer-токен; не нужен, если задан `auth`. */
  token?: string
  /** Способ авторизации; без него — Bearer `token`. */
  auth?: OnecAuth
  /** Запросы стенда проверки: заголовок `X-LK-Test: 1` (docs/onec-contract.md §1.7). Сам ЛК не ставит. */
  testMode?: boolean
  fetch?: typeof fetch
  timeoutMs?: number
  /** Сколько раз повторить после первой попытки; по умолчанию 0. */
  retries?: number
  log?: (entry: OnecLogEntry) => void
  sleep?: (ms: number) => Promise<void>
}

export interface ListParams {
  changedSince?: string
  page?: number
  pageSize?: number
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export class OnecClient {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly retries: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly options: OnecClientOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? 15_000
    // Без повторов по умолчанию: 1С хрупкая, повтор — следующий запуск расписания (§1.6).
    this.retries = options.retries ?? 0
    this.sleep = options.sleep ?? defaultSleep
  }

  clients(params: ListParams = {}) {
    return this.request('GET', '/clients', ClientsPage, { query: params })
  }

  catalog(params: ListParams = {}) {
    return this.request('GET', '/catalog', CatalogPage, { query: params })
  }

  /** Прайс по видам цен, по изменениям (§2.4): ЛК хранит его и считает цену клиента сам. */
  prices(params: ListParams = {}) {
    return this.request('GET', '/prices', PricesPage, { query: params })
  }

  stock(params: ListParams = {}) {
    return this.request('GET', '/stock', StockPage, { query: params })
  }

  /** Идемпотентно по `externalId`, поэтому повтор после таймаута не создаст второй заказ. */
  async createOrder(input: z.input<typeof OrderRequest>) {
    return this.request('POST', '/order', OrderCreated, { body: OrderRequest.parse(input) })
  }

  /** Картинка товара в base64 (§2.8). */
  image(id: string) {
    return this.request('GET', `/image/${encodeURIComponent(id)}`, ImageFile)
  }

  /** График доставки по регионам целиком (§2.8): справочник маленький, без страниц. */
  deliverySchedule() {
    return this.request('GET', '/delivery-schedule', DeliverySchedulePage)
  }

  /** Задания на перевозку по изменениям (§2.9). */
  trips(params: ListParams = {}) {
    return this.request('GET', '/trips', TripsPage, { query: params })
  }

  orderStatus(params: ListParams = {}) {
    return this.request('GET', '/orders/status', OrderStatusPage, { query: params })
  }

  private async request<S extends z.ZodType>(
    method: 'GET' | 'POST',
    path: string,
    schema: S,
    init: { query?: ListParams, body?: unknown } = {},
  ): Promise<z.infer<S>> {
    const url = new URL(this.options.baseUrl.replace(/\/+$/, '') + path)
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }

    let last: OnecError | undefined
    for (let attempt = 1; attempt <= this.retries + 1; attempt++) {
      if (attempt > 1) await this.sleep(200 * 2 ** (attempt - 2))
      const started = Date.now()
      try {
        const result = await this.once(method, url, init.body, schema)
        this.options.log?.({ method, path, status: result.status, ms: Date.now() - started, attempt })
        return result.data
      }
      catch (e) {
        last = e instanceof OnecError ? e : new OnecError('network', String(e))
        this.options.log?.({ method, path, status: last.status ?? null, ms: Date.now() - started, attempt, error: last.kind })
        if (!last.retryable) throw last
      }
    }
    throw last!
  }

  private async once<S extends z.ZodType>(method: string, url: URL, body: unknown, schema: S) {
    const failed = (e: unknown) => {
      const name = (e as { name?: string }).name
      return new OnecError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', `1C ${method} ${url.pathname}: ${name ?? 'network error'}`)
    }
    let response: Response
    let text: string
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          'authorization': onecAuthHeader(this.options.auth ?? { kind: 'bearer', token: this.options.token ?? '' }),
          'accept': 'application/json',
          ...(this.options.testMode ? { 'x-lk-test': '1' } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      // Тело читается под тем же таймаутом: обрыв после заголовков — сбой связи, его повторяем,
      // а не «нарушение контракта» (находка ревью PR #2).
      text = await response.text()
    }
    catch (e) {
      throw failed(e)
    }

    let payload: unknown
    try {
      payload = text ? JSON.parse(text) : undefined
    }
    catch {
      payload = undefined
    }
    if (!response.ok) {
      const parsed = ErrorBody.safeParse(payload)
      throw new OnecError('http', `1C ${method} ${url.pathname}: HTTP ${response.status}`, response.status, parsed.success ? parsed.data.error : undefined)
    }
    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      // Путь и поле нарушения — без значений: в ответе 1С могут быть данные клиентов.
      const where = parsed.error.issues.slice(0, 3).map(i => i.path.join('.') || '(root)').join(', ')
      throw new OnecError('contract', `1C ${method} ${url.pathname}: response breaks contract at ${where}`, response.status)
    }
    return { status: response.status, data: parsed.data as z.infer<S> }
  }
}

/**
 * То, чем ЛК пользуется от 1С: HTTP-сервис (`OnecClient`) или OData (`OdataOnec`, docs/onec-odata.md).
 * `stockIsSnapshot` — остатки приходят снимком целиком: чего нет в снимке, того на складе нет.
 */
export type OnecApi = Pick<OnecClient, 'clients' | 'catalog' | 'prices' | 'stock' | 'createOrder' | 'image' | 'deliverySchedule' | 'trips' | 'orderStatus'> & { readonly stockIsSnapshot?: boolean }

/** Все страницы списка подряд — для синхронизации по курсору. */
export async function collectPages<T>(
  load: (page: number) => Promise<{ items: T[], nextPage: number | null }>,
  maxPages = 1000,
): Promise<T[]> {
  const out: T[] = []
  let pageNo: number | null = 1
  for (let n = 0; pageNo !== null; n++) {
    if (n >= maxPages) throw new OnecError('contract', `1C: more than ${maxPages} pages — nextPage never ends`)
    const pageData = await load(pageNo)
    out.push(...pageData.items)
    if (pageData.nextPage !== null && pageData.nextPage <= pageNo) throw new OnecError('contract', '1C: nextPage does not advance')
    pageNo = pageData.nextPage
  }
  return out
}
