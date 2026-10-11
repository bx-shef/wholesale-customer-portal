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
  CatalogPage, ClientsPage, Contract, ErrorBody, OrderCreated, OrderRequest, OrderStatusPage,
  PricesRequest, PricesResponse, StockPage,
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

export interface OnecClientOptions {
  /** База без завершающего `/`, например `https://1c.example.by/hs/lk` или `http://mock/mock-1c`. */
  baseUrl: string
  token: string
  fetch?: typeof fetch
  timeoutMs?: number
  /** Сколько раз повторить после первой попытки. */
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
    this.retries = options.retries ?? 2
    this.sleep = options.sleep ?? defaultSleep
  }

  clients(params: ListParams = {}) {
    return this.request('GET', '/clients', ClientsPage, { query: params })
  }

  contract(clientGuid: string) {
    return this.request('GET', `/client/${encodeURIComponent(clientGuid)}/contract`, Contract)
  }

  catalog(params: ListParams = {}) {
    return this.request('GET', '/catalog', CatalogPage, { query: params })
  }

  async prices(input: z.input<typeof PricesRequest>) {
    return this.request('POST', '/prices', PricesResponse, { body: PricesRequest.parse(input) })
  }

  stock(params: ListParams = {}) {
    return this.request('GET', '/stock', StockPage, { query: params })
  }

  /** Идемпотентно по `externalId`, поэтому повтор после таймаута не создаст второй заказ. */
  async createOrder(input: z.input<typeof OrderRequest>) {
    return this.request('POST', '/order', OrderCreated, { body: OrderRequest.parse(input) })
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
          'authorization': `Bearer ${this.options.token}`,
          'accept': 'application/json',
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
