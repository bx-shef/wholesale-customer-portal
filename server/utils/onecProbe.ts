/**
 * Стенд проверки сервиса 1С (docs/onec-contract.md, раздел 3): по очереди вызывает методы
 * контракта и сверяет ответы со схемами — через тот же клиент, которым ходит ЛК, поэтому
 * «прошло на стенде» значит «ЛК прочитает». Чистое ядро: `fetch` внедряется, тесты гоняют его
 * против мока.
 *
 * Токен или пароль 1С проверке нужен только в памяти: не сохраняется и не попадает ни в отчёт, ни в журнал.
 */
import { randomUUID } from 'node:crypto'
import { OnecClient, OnecError, onecAuthHeader, type OnecAuth } from '../services/onec'
import { ErrorBody, type ClientT, type ItemT, type PriceT } from '../../shared/onec/schemas'

export interface ProbeInput {
  baseUrl: string
  auth: OnecAuth
  /** Создать тестовый заказ (пишет в базу 1С) — только на тестовой базе. */
  allowOrder: boolean
  fetch: typeof fetch
}

export interface ProbeCheck {
  id: string
  title: string
  status: 'ok' | 'fail' | 'skip'
  detail: string
  ms: number
}

/** Адрес сервиса: только https, без логина в адресе. Мок ЛК — исключение для http внутри процесса не нужно. */
export function checkBaseUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null
    return u.toString().replace(/\/+$/, '')
  }
  catch {
    return null
  }
}

const describe = (e: unknown) => {
  if (e instanceof OnecError) {
    const what = e.kind === 'contract'
      ? 'ответ не по контракту'
      : e.kind === 'timeout' ? 'нет ответа за 15 с' : e.kind === 'network' ? 'не удалось соединиться' : `HTTP ${e.status}${e.code ? ` (${e.code})` : ''}`
    return `${what}: ${e.message.replace(/^1C [A-Z]+ /, '')}`
  }
  return e instanceof Error ? e.message : String(e)
}

export async function runOnecProbe(input: ProbeInput, now: () => number = Date.now): Promise<ProbeCheck[]> {
  const checks: ProbeCheck[] = []
  const started0 = now() - 60_000
  let lastStatus = null as number | null
  const status = () => lastStatus
  const client = new OnecClient({
    baseUrl: input.baseUrl,
    auth: input.auth,
    fetch: input.fetch,
    retries: 0,
    testMode: true,
    log: (e) => { lastStatus = e.status },
  })
  const raw = (path: string, headers: Record<string, string> = {}) =>
    input.fetch(new URL(input.baseUrl.replace(/\/+$/, '') + path), { headers: { 'accept': 'application/json', 'x-lk-test': '1', ...headers } })

  async function check(id: string, title: string, run: () => Promise<string>, skipReason?: string) {
    if (skipReason) {
      checks.push({ id, title, status: 'skip', detail: skipReason, ms: 0 })
      return
    }
    const started = now()
    try {
      const detail = await run()
      checks.push({ id, title, status: 'ok', detail, ms: now() - started })
    }
    catch (e) {
      checks.push({ id, title, status: 'fail', detail: describe(e), ms: now() - started })
    }
  }
  const expect401 = async (headers: Record<string, string>) => {
    const res = await raw('/clients', headers)
    if (res.status !== 401) throw new Error(`ожидали 401, пришёл ${res.status}`)
    const body = ErrorBody.safeParse(await res.json().catch(() => null))
    if (!body.success) throw new Error('401 без тела {"error": "...", "message": "..."}')
    return '401 с телом ошибки'
  }

  await check('auth-none', 'Без токена — 401', () => expect401({}))
  const wrong: OnecAuth = input.auth.kind === 'basic'
    ? { kind: 'basic', login: input.auth.login, password: `wrong-${randomUUID()}` }
    : { kind: 'bearer', token: `wrong-${randomUUID()}` }
  await check('auth-wrong', input.auth.kind === 'basic' ? 'Неверный пароль — 401' : 'Чужой токен — 401', () => expect401({ authorization: onecAuthHeader(wrong) }))

  let clients: ClientT[] = []
  await check('clients', 'GET /clients — список клиентов', async () => {
    const page = await client.clients({ pageSize: 50 })
    clients = page.items
    if (page.items.length === 0) throw new Error('пустой список: нужен хотя бы один клиент')
    return `клиентов на первой странице: ${page.items.length}${page.nextPage ? ', есть ещё страницы' : ''}`
  })

  await check('page-size', 'pageSize=501 — 400', async () => {
    const res = await raw('/clients?pageSize=501', { authorization: onecAuthHeader(input.auth) })
    if (res.status !== 400) throw new Error(`ожидали 400, пришёл ${res.status}`)
    return '400'
  })

  await check('paging', 'Страницы по 2 — без повторов, nextPage растёт', async () => {
    const first = await client.clients({ pageSize: 2 })
    if (first.nextPage === null) return 'клиентов не больше двух — листать нечего'
    const second = await client.clients({ pageSize: 2, page: first.nextPage })
    const guids = [...first.items, ...second.items].map(c => c.guid.toLowerCase())
    if (new Set(guids).size !== guids.length) throw new Error('один клиент на двух страницах: порядок не по changedAt и GUID')
    if (second.nextPage !== null && second.nextPage <= first.nextPage) throw new Error('nextPage не растёт')
    return `две страницы, ${guids.length} разных клиентов`
  })

  await check('since-future', 'changedSince из будущего — пустой список', async () => {
    const page = await client.clients({ changedSince: '2999-01-01T00:00:00Z' })
    if (page.items.length !== 0 || page.nextPage !== null) throw new Error('ожидали {"items": [], "nextPage": null}')
    return 'пусто'
  })

  const withContract = () => clients.find(c => c.contractGuid && !c.deleted)
  await check('contract', 'GET /client/{guid}/contract — договор', async () => {
    const c = withContract()!
    const contract = await client.contract(c.guid)
    if (contract.guid.toLowerCase() !== c.contractGuid!.toLowerCase()) throw new Error('guid договора не совпал с contractGuid клиента')
    return `договор ${contract.number}, отсрочка ${contract.paymentDelayDays} дн., ${contract.currency}`
  }, clients.length && !withContract() ? 'нет клиента с договором' : !clients.length ? 'нет клиентов' : undefined)

  await check('contract-404', 'Договор неизвестного клиента — 404', async () => {
    try {
      await client.contract('00000000-0000-4000-8000-000000000000')
    }
    catch (e) {
      if (e instanceof OnecError && e.status === 404) return '404'
      throw e
    }
    throw new Error('ожидали 404, пришёл ответ с договором')
  })

  let items: ItemT[] = []
  await check('catalog', 'GET /catalog — разделы и товары', async () => {
    const page = await client.catalog({ pageSize: 50 })
    items = page.items
    if (page.sections.length === 0) throw new Error('на первой странице нет разделов (sections)')
    const unknown = page.items.find(i => !page.sections.some(s => s.guid.toLowerCase() === i.sectionGuid.toLowerCase()))
    return `разделов: ${page.sections.length}, товаров на странице: ${page.items.length}${unknown ? `; у товара ${unknown.sku} раздел не из sections` : ''}`
  })

  let prices: PriceT[] = []
  const priceClient = () => withContract()
  await check('prices', 'POST /prices — цены клиента', async () => {
    prices = await client.prices({ clientGuid: priceClient()!.guid, items: items.slice(0, 20).map(i => i.guid) })
    if (prices.length === 0) throw new Error('ни одной цены на 20 товаров: проверьте вид цен договора')
    const wanted = new Set(items.slice(0, 20).map(i => i.guid.toLowerCase()))
    if (prices.some(p => !wanted.has(p.itemGuid.toLowerCase()))) throw new Error('в ответе товар, которого не спрашивали')
    return `цен: ${prices.length} из ${Math.min(20, items.length)}`
  }, !priceClient() ? 'нет клиента с договором' : !items.length ? 'нет товаров' : undefined)

  await check('stock', 'GET /stock — остатки', async () => {
    const page = await client.stock({ pageSize: 50 })
    return `строк на первой странице: ${page.items.length}`
  })

  await check('orders-status', 'GET /orders/status — статусы', async () => {
    const page = await client.orderStatus({ pageSize: 50 })
    return `заказов на первой странице: ${page.items.length}`
  })

  const orderClient = priceClient()
  const priced = prices[0]
  const address = orderClient?.deliveryAddresses[0]
  await check('order', 'POST /order — создание и повтор с тем же externalId', async () => {
    const body = {
      externalId: `lk-test-${randomUUID().slice(0, 8)}`,
      clientGuid: orderClient!.guid,
      contractGuid: orderClient!.contractGuid!,
      deliveryAddressGuid: address!.guid,
      deliveryDate: new Date(now() + 86_400_000).toISOString().slice(0, 10),
      comment: 'Проверка стенда ЛК — тестовый заказ, можно удалить',
      test: true,
      items: [{ itemGuid: priced!.itemGuid, qty: 1, price: priced!.price }],
    }
    const created = await client.createOrder(body)
    if (status() !== 201) throw new Error(`первое создание: ожидали 201, пришёл ${status()}`)
    const again = await client.createOrder(body)
    if (status() !== 200) throw new Error(`повтор: ожидали 200, пришёл ${status()}`)
    if (again.orderGuid.toLowerCase() !== created.orderGuid.toLowerCase()) throw new Error('повтор создал второй заказ')
    const listed = await client.orderStatus({ changedSince: new Date(started0).toISOString() })
    if (listed.items.some(o => o.orderGuid.toLowerCase() === created.orderGuid.toLowerCase())) throw new Error('тестовый заказ (test: true) попал в /orders/status')
    return `заказ ${created.number}, повтор вернул тот же, в статусах его нет`
  }, !input.allowOrder
    ? 'выключено галкой'
    : !orderClient ? 'нет клиента с договором' : !address ? 'у клиента нет адреса доставки' : !priced ? 'нет товара с ценой' : undefined)

  return checks
}
