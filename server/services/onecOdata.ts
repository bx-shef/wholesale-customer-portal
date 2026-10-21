/**
 * Клиент 1С по стандартному OData (docs/onec-odata.md): собирает из объектов 1С те же формы, что
 * контракт `shared/onec/schemas.ts`, поэтому синхронизации и страницы ЛК от транспорта не зависят.
 *
 * Каталог, картинки, цены и остатки. Сопоставление полей и открытые вопросы — в документе.
 * Ответ проверяется схемой контракта: «прошло здесь» значит «ЛК прочитает».
 */
import type { z } from 'zod'
import { CatalogPage, ImageFile, PAGE_SIZE_MAX, Price, Stock, type ImageFileT, type ItemT, type PriceT, type SectionT, type StockT } from '../../shared/onec/schemas'
import { OnecError, onecAuthHeader, type OnecAuth } from './onec'

/** Пустая ссылка 1С: поле `_Key` без значения. */
export const EMPTY_REF = '00000000-0000-0000-0000-000000000000'
/** Раздел для товаров без вида номенклатуры: в контракте у каждого товара есть раздел. */
export const ROOT_SECTION: SectionT = { guid: EMPTY_REF, parentGuid: null, name: 'Без группы' }

export interface ODataOptions {
  /** `https://…/<база>/odata/standard.odata` */
  baseUrl: string
  auth: OnecAuth
  fetch?: typeof fetch
  timeoutMs?: number
  /** Время ответа: у объектов 1С нет даты изменения, `changedAt` — момент чтения. */
  now?: () => Date
  /**
   * Склады, остаток которых видит клиент, — по наименованию (`ONEC_STOCK_WAREHOUSES`).
   * Пусто — все склады. Решение владельца 2026-10-21: только «Основной склад».
   */
  stockWarehouses?: string[]
  /** Журнал запросов (стенд): что спросили, сколько шло, сколько строк или какая ошибка. Без данных. */
  onRequest?: (e: { label: string, ms: number, rows?: number, error?: string }) => void
}

/** Склады по умолчанию для остатков клиенту (решение владельца 2026-10-21). */
export const DEFAULT_STOCK_WAREHOUSES = ['Основной склад']

/** Поля номенклатуры, которые читаем: `$select` бережёт 1С — у объекта больше сотни полей. */
export const NOMENCLATURE_FIELDS = [
  'Ref_Key', 'DataVersion', 'Description', 'Parent_Key', 'IsFolder', 'DeletionMark',
  'Артикул', 'art_НаименованиеДляСайта', 'Описание', 'ЕдиницаИзмерения_Key', 'Марка_Key', 'ФайлКартинки_Key', 'ВидНоменклатуры_Key',
] as const

export interface NomenclatureRow {
  Ref_Key: string
  DataVersion?: string
  Description?: string
  Parent_Key?: string
  IsFolder?: boolean
  DeletionMark?: boolean
  Артикул?: string
  art_НаименованиеДляСайта?: string
  Описание?: string
  ЕдиницаИзмерения_Key?: string
  Марка_Key?: string
  ФайлКартинки_Key?: string
  ВидНоменклатуры_Key?: string
}

/** Справочники, которые могут быть ещё не опубликованы: без них поле заполняется запасным значением. */
export interface CatalogLookups {
  units: Map<string, string>
  brands: Map<string, string>
}

const ref = (v: string | undefined) => (v && v !== EMPTY_REF ? v.toLowerCase() : null)

/** Раздел ЛК — вид номенклатуры 1С (решение владельца, onec-contract.md §2.2). */
export function mapSection(row: { Ref_Key: string, Description?: string, Parent_Key?: string }): SectionT {
  return { guid: row.Ref_Key, parentGuid: ref(row.Parent_Key), name: (row.Description ?? '').trim() }
}

/**
 * Товар контракта из строки номенклатуры. Чего OData пока не даёт — запасные значения:
 * единица «шт», кратность и минимум 1, свойств и аналогов нет (docs/onec-odata.md).
 */
export function mapItem(row: NomenclatureRow, lookups: CatalogLookups, changedAt: string): ItemT {
  const unitKey = ref(row.ЕдиницаИзмерения_Key)
  const brandKey = ref(row.Марка_Key)
  const image = ref(row.ФайлКартинки_Key)
  return {
    guid: row.Ref_Key,
    sku: (row.Артикул ?? '').trim(),
    name: (row.art_НаименованиеДляСайта || row.Description || '').trim(),
    sectionGuid: ref(row.ВидНоменклатуры_Key) ?? ROOT_SECTION.guid,
    brand: (brandKey && lookups.brands.get(brandKey)) || '',
    unit: (unitKey && lookups.units.get(unitKey)) || 'шт',
    packQty: 1,
    minQty: 1,
    description: (row.Описание ?? '').trim(),
    properties: {},
    // Хэш картинки — по ссылке на файл: версию файла узнаем, когда дойдём до загрузки картинок.
    images: image ? [{ id: image, hash: image.replaceAll('-', '') }] : [],
    analogs: [],
    changedAt,
    deleted: row.DeletionMark === true,
  }
}

export class ODataClient {
  private readonly fetchImpl: typeof fetch
  private readonly base: string

  constructor(private readonly options: ODataOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.base = options.baseUrl.replace(/\/+$/, '')
  }

  /** Строки набора: `value` из ответа 1С. */
  list<T>(set: string, query: Record<string, string | number>, maxBytes?: number): Promise<T[]> {
    return this.listPath(encodeURIComponent(set), set, query, maxBytes)
  }

  /**
   * Строки по готовому пути: набор с функцией 1С (`…/SliceLast()`, `…/Balance(…)`).
   * `path` уже закодирован, `label` — для текста ошибки.
   */
  async listPath<T>(path: string, label: string, query: Record<string, string | number>, maxBytes = ODATA_MAX_RESPONSE): Promise<T[]> {
    const started = Date.now()
    const what = `${label}${query.$top !== undefined ? ` [$top=${query.$top}${query.$skip ? `, $skip=${query.$skip}` : ''}]` : ''}`
    try {
      const rows = await this.listPathRaw<T>(path, label, query, maxBytes)
      this.options.onRequest?.({ label: what, ms: Date.now() - started, rows: rows.length })
      return rows
    }
    catch (e) {
      this.options.onRequest?.({ label: what, ms: Date.now() - started, error: (e as Error).message })
      throw e
    }
  }

  private async listPathRaw<T>(path: string, label: string, query: Record<string, string | number>, maxBytes: number): Promise<T[]> {
    const set = label
    const qs = Object.entries({ ...query, $format: 'json' })
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
    const url = `${this.base}/${path}?${qs}`
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        headers: { authorization: onecAuthHeader(this.options.auth), accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
      })
    }
    catch (e) {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
      throw new OnecError(timeout ? 'timeout' : 'network', `1C OData ${set}: ${timeout ? 'timeout' : (e as Error).message}`)
    }
    if (!res.ok) {
      // Текст ошибки 1С — про запрос, а не про данные; режем до 200 знаков, чтобы стенд показал причину.
      const body = await res.json().catch(() => null) as { 'odata.error'?: { message?: { value?: string } } } | null
      const why = body?.['odata.error']?.message?.value?.replace(/\s+/g, ' ').slice(0, 200)
      throw new OnecError('http', `1C OData ${set}: HTTP ${res.status}${why ? ` — ${why}` : ''}`, res.status)
    }
    // Предел ответа — до разбора: огромный ответ кладёт процесс ЛК по памяти (502, 2026-10-21).
    const tooBig = () => new OnecError('contract', `1C OData ${set}: response is larger than ${Math.round(maxBytes / 1048576)} MB`, res.status)
    if (Number(res.headers.get('content-length') ?? 0) > maxBytes) throw tooBig()
    const text = await readBodyLimited(res, maxBytes)
    if (text === null) throw tooBig()
    let body: { value?: unknown } | null
    try {
      body = JSON.parse(text) as { value?: unknown }
    }
    catch {
      body = null
    }
    if (!body || !Array.isArray(body.value)) throw new OnecError('contract', `1C OData ${set}: no "value" array`, res.status)
    return body.value as T[]
  }

  /** Справочник «ссылка → наименование»; не опубликован или не читается — пустой, с причиной. */
  async names(set: string): Promise<{ map: Map<string, string>, error?: string }> {
    try {
      const rows = await this.list<{ Ref_Key: string, Description?: string }>(set, { $select: 'Ref_Key,Description' })
      return { map: new Map(rows.map(r => [r.Ref_Key.toLowerCase(), (r.Description ?? '').trim()])) }
    }
    catch (e) {
      return { map: new Map(), error: (e as Error).message }
    }
  }

  /**
   * Страница каталога по контракту. Курсора нет — `changedSince` не поддерживается, каждый прогон
   * полный (docs/onec-odata.md). Разделы — группы номенклатуры, все на первой странице.
   */
  async catalog(params: { page?: number, pageSize?: number } = {}, lookups?: CatalogLookups): Promise<z.infer<typeof CatalogPage>> {
    const page = params.page ?? 1
    const pageSize = Math.min(params.pageSize ?? PAGE_SIZE_MAX, PAGE_SIZE_MAX)
    const changedAt = (this.options.now?.() ?? new Date()).toISOString()
    const look = lookups ?? await this.catalogLookups()
    const select = NOMENCLATURE_FIELDS.join(',')
    const sections = page === 1 ? await this.sections() : []
    // Одной строкой больше страницы — чтобы понять, есть ли следующая, без отдельного $count.
    const rows = await this.list<NomenclatureRow>('Catalog_Номенклатура', {
      $select: select,
      $filter: 'IsFolder eq false',
      $orderby: 'Ref_Key',
      $top: pageSize + 1,
      $skip: (page - 1) * pageSize,
    })
    const result = {
      sections,
      items: rows.slice(0, pageSize).map(r => mapItem(r, look, changedAt)),
      nextPage: rows.length > pageSize ? page + 1 : null,
    }
    const parsed = CatalogPage.safeParse(result)
    if (!parsed.success) {
      const where = parsed.error.issues.slice(0, 3).map(i => i.path.join('.')).join(', ')
      throw new OnecError('contract', `1C OData catalog: breaks contract at ${where}`)
    }
    return parsed.data
  }

  /** Разделы — виды номенклатуры, кроме помеченных на удаление, и «Без группы». */
  async sections(): Promise<SectionT[]> {
    const rows = await this.list<{ Ref_Key: string, Description?: string, Parent_Key?: string, DeletionMark?: boolean }>('Catalog_ВидыНоменклатуры', { $select: 'Ref_Key,Description,Parent_Key,DeletionMark' })
    return [ROOT_SECTION, ...rows.filter(r => !r.DeletionMark).map(mapSection)]
  }

  /**
   * Каталог целиком — для синхронизации: разделы и все товары с версией объекта (`DataVersion`),
   * страницами по `ODATA_PAGE` строк. Момент изменения проставляет вызывающий по версии.
   */
  async catalogSnapshot(): Promise<{ sections: SectionT[], items: Array<{ item: ItemT, version: string }> }> {
    const look = await this.catalogLookups()
    const sections = await this.sections()
    const select = NOMENCLATURE_FIELDS.join(',')
    const items: Array<{ item: ItemT, version: string }> = []
    for (let page = 0; ; page++) {
      if (page >= ODATA_MAX_PAGES) throw new OnecError('contract', `1C OData Catalog_Номенклатура: more than ${ODATA_MAX_PAGES} pages`)
      const rows = await this.list<NomenclatureRow>('Catalog_Номенклатура', { $select: select, $filter: 'IsFolder eq false', $orderby: 'Ref_Key', $top: ODATA_PAGE, $skip: page * ODATA_PAGE })
      for (const r of rows) items.push({ item: mapItem(r, look, ''), version: r.DataVersion ?? '' })
      if (rows.length < ODATA_PAGE) break
    }
    return { sections, items }
  }

  /**
   * Картинка товара (§2.3) из `Catalog_НоменклатураПрисоединенныеФайлы`: хранится в базе 1С
   * (ответ программиста 2026-10-20). Тип — по расширению; не картинка — ошибка контракта.
   */
  async image(id: string): Promise<ImageFileT> {
    assertGuid(id)
    const set = 'Catalog_НоменклатураПрисоединенныеФайлы'
    const rows = await this.list<{ Ref_Key: string, Расширение?: string, ФайлХранилище_Base64Data?: string }>(set, {
      $select: 'Ref_Key,Расширение,ФайлХранилище_Base64Data',
      $filter: `Ref_Key eq guid'${id}'`,
      $top: 1,
    }, IMAGE_MAX_RESPONSE)
    const row = rows[0]
    if (!row) throw new OnecError('http', `1C OData ${set}: not found`, 404)
    const contentType = IMAGE_EXT[(row.Расширение ?? '').toLowerCase().replace(/^\./, '')]
    if (!contentType) throw new OnecError('contract', `1C OData ${set}: not an image (${(row.Расширение ?? '').slice(0, 10)})`)
    const parsed = ImageFile.safeParse({ id, hash: id.replaceAll('-', ''), contentType, data: (row.ФайлХранилище_Base64Data ?? '').replace(/\s+/g, '') })
    if (!parsed.success) throw new OnecError('contract', `1C OData ${set}: image breaks contract at ${parsed.error.issues[0]?.path.join('.')}`)
    return parsed.data
  }

  async catalogLookups(): Promise<CatalogLookups & { missing: string[] }> {
    // По очереди: 1С держим на одном запросе за раз (onecGuard).
    const units = await this.names('Catalog_УпаковкиЕдиницыИзмерения')
    const brands = await this.names('Catalog_Марки')
    return {
      units: units.map,
      brands: brands.map,
      missing: [units.error && 'Catalog_УпаковкиЕдиницыИзмерения', brands.error && 'Catalog_Марки'].filter((x): x is string => !!x),
    }
  }

  /**
   * Прайс по видам цен (§2.4) — действующие цены: срез последних `InformationRegister_ЦеныНоменклатуры25`.
   * Если 1С срез не отдаёт — все записи регистра и последняя по дате (`via: 'records'`).
   * Курсора нет: каждый прогон полный. `priceTypes` — только эти виды цен (меньше читать).
   */
  async prices(opts: { priceTypes?: string[], limit?: number, items?: string[] } = {}): Promise<PricesResult> {
    const filter: Record<string, string> = opts.priceTypes?.length ? { $filter: opts.priceTypes.map(g => `ВидЦены_Key eq guid'${assertGuid(g)}'`).join(' or ') } : {}
    // Цены продажи — в `ЦеныНоменклатуры` (ответ программиста 1С 2026-10-21; `ЦеныНоменклатуры25`
    // пуст). Срез последних 1С отдаёт; читаем его страницами: в регистре сотни тысяч записей,
    // один большой ответ кладёт процесс ЛК по памяти (502 того же дня).
    const register = PRICE_REGISTERS[0]
    const pageSize = Math.min(opts.limit ?? ODATA_PAGE, ODATA_PAGE)
    const tried: string[] = []
    const via: PricesResult['via'] = 'slice'
    // Регистр подчинён регистратору: `…/SliceLast()` у самого набора 1С отвергает («лишние
    // сегменты в запросе к контейнеру сущностей», прогон 2026-10-21) — срез берём у `_RecordType`.
    // Прежний путь оставлен запасным: на какой из них ответит база, видно в `tried`.
    let rows: PriceRow[] = []
    for (const base of [`${register}_RecordType`, register]) {
      const slice = `${encodeURIComponent(base)}/SliceLast()`
      try {
        rows = []
        for (let page = 0; ; page++) {
          const chunk = await this.listPath<PriceRow>(slice, `${base}/SliceLast`, { ...filter, $top: pageSize, $skip: page * pageSize })
          rows.push(...chunk)
          if (chunk.length < pageSize || (opts.limit && rows.length >= opts.limit)) break
          if (page >= ODATA_MAX_PAGES) throw new OnecError('contract', `1C OData ${base}/SliceLast: more than ${ODATA_MAX_PAGES} pages`)
        }
        break
      }
      catch (e) {
        if (!(e instanceof OnecError) || e.kind !== 'http') throw e
        tried.push(`${base}/SliceLast: ${e.message}`)
      }
    }
    const currencies = await this.currencies()
    const vat = await this.vatByItem(opts.items ?? (opts.limit ? [...new Set(rows.map(r => r.Номенклатура_Key))].slice(0, 20) : undefined))
    const stats = emptyPriceStats()
    const items = mapPrices(rows, { currencies: currencies.map, vat: vat.map }, stats)
    return {
      items: checked(Price, items, 'prices'),
      via,
      register,
      tried,
      stats,
      missing: [currencies.error && 'Catalog_Валюты', vat.error && 'Catalog_СтавкиНДС'].filter((x): x is string => !!x),
    }
  }

  /**
   * Записи регистра, подчинённого регистратору: набор `InformationRegister_X` — это наборы записей
   * документов (`Recorder` + `RecordSet`). Читаем страницами и разворачиваем строки.
   */
  async recordSets(set: string, pageSize = 200, maxPages = 2000, partial = false): Promise<PriceRow[]> {
    const out: PriceRow[] = []
    for (let page = 0; page < maxPages; page++) {
      const sets = await this.list<{ RecordSet?: PriceRow[] }>(set, { $top: pageSize, $skip: page * pageSize })
      for (const rs of sets) out.push(...(rs.RecordSet ?? []))
      if (sets.length < pageSize) return out
    }
    if (partial) return out
    throw new OnecError('contract', `1C OData ${set}: more than ${maxPages} pages`)
  }

  /** Остатки (§2.5): `ВНаличии − КОтгрузке` по номенклатуре и складу. */
  async stock(): Promise<StockT[]> {
    const set = 'AccumulationRegister_ТоварыНаСкладах'
    const rows = await this.listPath<StockRow>(
      `${encodeURIComponent(set)}/Balance(Dimensions='${encodeURIComponent('Номенклатура,Склад')}')`,
      `${set}/Balance`,
      { $select: 'Номенклатура_Key,Склад_Key,ВНаличииBalance,КОтгрузкеBalance' },
    )
    const warehouses = await this.names('Catalog_Склады')
    const changedAt = (this.options.now?.() ?? new Date()).toISOString()
    const only = new Set((this.options.stockWarehouses ?? []).map(n => n.trim().toLowerCase()).filter(Boolean))
    const all = mapStock(rows, warehouses.map, changedAt)
    return checked(Stock, only.size ? all.filter(s => only.has(s.warehouseName.trim().toLowerCase())) : all, 'stock')
  }

  /** Валюта по ссылке: буквенный код из наименования или по числовому коду. */
  async currencies(): Promise<{ map: Map<string, string>, error?: string }> {
    try {
      const rows = await this.list<{ Ref_Key: string, Code?: string, Description?: string }>('Catalog_Валюты', { $select: 'Ref_Key,Code,Description' })
      return { map: new Map(rows.flatMap((r) => {
        const code = currencyCode(r.Code, r.Description)
        return code ? [[r.Ref_Key.toLowerCase(), code] as const] : []
      })) }
    }
    catch (e) {
      return { map: new Map(), error: (e as Error).message }
    }
  }

  /** Ставка НДС товара в процентах: номенклатура → `Catalog_СтавкиНДС`. */
  /** `items` — только эти товары (стенд): весь справочник ради образца не читаем. */
  async vatByItem(items?: string[]): Promise<{ map: Map<string, number>, error?: string }> {
    try {
      const rates = await this.list<{ Ref_Key: string, Description?: string, Ставка?: number }>('Catalog_СтавкиНДС', {})
      const rate = new Map(rates.map(r => [r.Ref_Key.toLowerCase(), vatPercent(r.Ставка, r.Description)]))
      if (items && !items.length) return { map: new Map() }
      const filter = items ? items.map(g => `Ref_Key eq guid'${assertGuid(g)}'`).join(' or ') : 'IsFolder eq false'
      const rows = await this.list<{ Ref_Key: string, СтавкаНДС_Key?: string }>('Catalog_Номенклатура', { $select: 'Ref_Key,СтавкаНДС_Key', $filter: filter })
      return { map: new Map(rows.flatMap((i) => {
        const v = ref(i.СтавкаНДС_Key) && rate.get(ref(i.СтавкаНДС_Key)!)
        return typeof v === 'number' ? [[i.Ref_Key.toLowerCase(), v] as const] : []
      })) }
    }
    catch (e) {
      return { map: new Map(), error: (e as Error).message }
    }
  }
}

/** Регистры цен по порядку попыток (docs/onec-odata.md). */
export const PRICE_REGISTERS = ['InformationRegister_ЦеныНоменклатуры'] as const
/** Строк за один запрос OData (каталог, срез цен) и предел страниц: 500 × 5000 = 2,5 млн строк. */
export const ODATA_PAGE = 5000
/** Предел одного ответа OData и ответа с картинкой (base64 до 5 МБ файла — около 7 МБ строки). */
export const ODATA_MAX_RESPONSE = 64 * 1024 * 1024
export const IMAGE_MAX_RESPONSE = 8 * 1024 * 1024
const IMAGE_EXT: Record<string, 'image/jpeg' | 'image/png' | 'image/webp'> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
export const ODATA_MAX_PAGES = 500

export interface PriceStats {
  read: number
  inactive: number
  /** Цена характеристики или упаковки — ЛК продаёт товар целиком. */
  variant: number
  noRef: number
  noCurrency: number
  noPrice: number
  /** Цена 0 — уходит как удалённая: в ЛК «нет цены». */
  zero: number
}
export const emptyPriceStats = (): PriceStats => ({ read: 0, inactive: 0, variant: 0, noRef: 0, noCurrency: 0, noPrice: 0, zero: 0 })

export interface PricesResult {
  items: PriceT[]
  via: 'slice' | 'records'
  /** Регистр, из которого прочитаны цены. */
  register: string
  /** Что не сработало до удачного пути — для стенда. */
  tried: string[]
  stats: PriceStats
  missing: string[]
}

export interface PriceRow {
  Period?: string
  Active?: boolean
  Номенклатура_Key: string
  ВидЦены_Key: string
  Цена?: number
  Валюта_Key?: string
  ХарактеристикаЦО_Key?: string
  УпаковкаЦО_Key?: string
  /** Прежний регистр `ЦеныНоменклатуры`: те же измерения без «ЦО». */
  Характеристика_Key?: string
  Упаковка_Key?: string
}

export interface StockRow {
  Номенклатура_Key: string
  Склад_Key: string
  ВНаличииBalance?: number
  КОтгрузкеBalance?: number
}

/** Часовой пояс дат 1С: база в Минске, даты в OData без смещения. */
export const ONEC_TZ = '+03:00'
const ISO_NUM: Record<string, string> = { 933: 'BYN', 643: 'RUB', 840: 'USD', 978: 'EUR', 156: 'CNY', 985: 'PLN' }

export function currencyCode(code?: string, description?: string): string | null {
  const d = (description ?? '').trim().toUpperCase()
  if (/^[A-Z]{3}$/.test(d)) return d
  const c = (code ?? '').trim()
  if (/^[A-Z]{3}$/.test(c.toUpperCase())) return c.toUpperCase()
  return ISO_NUM[String(Number(c))] ?? null
}

/** «20%», «Без НДС», число из поля `Ставка`. */
export function vatPercent(rate?: number, description?: string): number {
  if (typeof rate === 'number' && Number.isFinite(rate) && rate >= 0) return rate
  const m = /(\d+(?:[.,]\d+)?)\s*%/.exec(description ?? '')
  return m ? Number(m[1]!.replace(',', '.')) : 0
}

/** GUID для `$filter`: в запрос 1С попадает только строго такой вид, без кавычек и операторов. */
export function assertGuid(g: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(g)) throw new OnecError('contract', '1C OData: id is not a GUID')
  return g
}

const money = (v: number) => Math.round(v * 100) / 100

/**
 * Действующая цена на товар и вид цен. Цены характеристик и упаковок ЛК не продаёт — пропускаем;
 * при чтении записей (`records`) берём последнюю активную по дате. Без валюты строку не отдаём:
 * цену в неизвестной валюте клиенту не покажешь.
 */
export function mapPrices(rows: PriceRow[], look: { currencies: Map<string, string>, vat: Map<string, number> }, stats = emptyPriceStats()): PriceT[] {
  const last = new Map<string, PriceRow>()
  stats.read += rows.length
  for (const r of rows) {
    if (r.Active === false) { stats.inactive++; continue }
    if (ref(r.ХарактеристикаЦО_Key) || ref(r.УпаковкаЦО_Key) || ref(r.Характеристика_Key)) { stats.variant++; continue }
    const item = ref(r.Номенклатура_Key)
    const type = ref(r.ВидЦены_Key)
    if (!item || !type) { stats.noRef++; continue }
    const key = `${item}|${type}`
    const prev = last.get(key)
    if (!prev || (r.Period ?? '') >= (prev.Period ?? '')) last.set(key, r)
  }
  const out: PriceT[] = []
  for (const r of last.values()) {
    const currency = ref(r.Валюта_Key) && look.currencies.get(ref(r.Валюта_Key)!)
    if (!currency) { stats.noCurrency++; continue }
    if (typeof r.Цена !== 'number' || r.Цена < 0) { stats.noPrice++; continue }
    // Цена 0 — «цены нет»: клиенту её не показываем и прежнюю ненулевую из ЛК убираем.
    if (money(r.Цена) === 0) stats.zero++
    const item = ref(r.Номенклатура_Key)!
    out.push({
      priceTypeGuid: ref(r.ВидЦены_Key)!,
      itemGuid: item,
      price: money(r.Цена),
      currency,
      vatRate: look.vat.get(item) ?? 0,
      changedAt: `${(r.Period ?? '2000-01-01T00:00:00').slice(0, 19)}${ONEC_TZ}`,
      deleted: money(r.Цена) === 0,
    })
  }
  return out
}

/** Свободный остаток: `ВНаличии − КОтгрузке`, не меньше нуля; пустые склады и товары пропускаем. */
export function mapStock(rows: StockRow[], warehouses: Map<string, string>, changedAt: string): StockT[] {
  return rows.flatMap((r) => {
    const item = ref(r.Номенклатура_Key)
    const wh = ref(r.Склад_Key)
    if (!item || !wh) return []
    const available = Math.max(0, (r.ВНаличииBalance ?? 0) - (r.КОтгрузкеBalance ?? 0))
    return [{ itemGuid: item, warehouseGuid: wh, warehouseName: warehouses.get(wh) ?? '', available: Math.round(available * 1000) / 1000, changedAt }]
  })
}

function checked<T>(schema: z.ZodType<T>, rows: T[], what: string): T[] {
  for (const [i, row] of rows.entries()) {
    const parsed = schema.safeParse(row)
    if (!parsed.success) throw new OnecError('contract', `1C OData ${what}: row ${i} breaks contract at ${parsed.error.issues.slice(0, 3).map(x => x.path.join('.')).join(', ')}`)
  }
  return rows
}

/**
 * Тело ответа не больше `maxBytes` байт, иначе `null`. Читается потоком и обрывается на пределе:
 * ответ без `content-length` (chunked через прокси) иначе лёг бы в память целиком (ревью PR #62).
 */
export async function readBodyLimited(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  }
  catch {
    return ''
  }
  return Buffer.concat(chunks).toString('utf8')
}
