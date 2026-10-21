/**
 * Клиент 1С по стандартному OData (docs/onec-odata.md): собирает из объектов 1С те же формы, что
 * контракт `shared/onec/schemas.ts`, поэтому синхронизации и страницы ЛК от транспорта не зависят.
 *
 * Сейчас — каталог (`Catalog_Номенклатура`). Сопоставление полей и открытые вопросы — в документе.
 * Ответ проверяется схемой контракта: «прошло здесь» значит «ЛК прочитает».
 */
import type { z } from 'zod'
import { CatalogPage, PAGE_SIZE_MAX, Price, Stock, type ItemT, type PriceT, type SectionT, type StockT } from '../../shared/onec/schemas'
import { OnecError, onecAuthHeader, type OnecAuth } from './onec'

/** Пустая ссылка 1С: поле `_Key` без значения. */
export const EMPTY_REF = '00000000-0000-0000-0000-000000000000'
/** Раздел для товаров вне групп: в контракте у каждого товара есть раздел. */
export const ROOT_SECTION: SectionT = { guid: EMPTY_REF, parentGuid: null, name: 'Без группы' }

export interface ODataOptions {
  /** `https://…/<база>/odata/standard.odata` */
  baseUrl: string
  auth: OnecAuth
  fetch?: typeof fetch
  timeoutMs?: number
  /** Время ответа: у объектов 1С нет даты изменения, `changedAt` — момент чтения. */
  now?: () => Date
}

/** Поля номенклатуры, которые читаем: `$select` бережёт 1С — у объекта больше сотни полей. */
export const NOMENCLATURE_FIELDS = [
  'Ref_Key', 'DataVersion', 'Description', 'Parent_Key', 'IsFolder', 'DeletionMark',
  'Артикул', 'art_НаименованиеДляСайта', 'Описание', 'ЕдиницаИзмерения_Key', 'Марка_Key', 'ФайлКартинки_Key',
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
}

/** Справочники, которые могут быть ещё не опубликованы: без них поле заполняется запасным значением. */
export interface CatalogLookups {
  units: Map<string, string>
  brands: Map<string, string>
}

const ref = (v: string | undefined) => (v && v !== EMPTY_REF ? v.toLowerCase() : null)

export function mapSection(row: NomenclatureRow): SectionT {
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
    sectionGuid: ref(row.Parent_Key) ?? ROOT_SECTION.guid,
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
  list<T>(set: string, query: Record<string, string | number>): Promise<T[]> {
    return this.listPath(encodeURIComponent(set), set, query)
  }

  /**
   * Строки по готовому пути: набор с функцией 1С (`…/SliceLast()`, `…/Balance(…)`).
   * `path` уже закодирован, `label` — для текста ошибки.
   */
  async listPath<T>(path: string, label: string, query: Record<string, string | number>): Promise<T[]> {
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
    const body = await res.json().catch(() => null) as { value?: unknown } | null
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
    const sections = page === 1
      ? [ROOT_SECTION, ...(await this.list<NomenclatureRow>('Catalog_Номенклатура', { $select: select, $filter: 'IsFolder eq true' })).map(mapSection)]
      : []
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
  async prices(opts: { priceTypes?: string[] } = {}): Promise<PricesResult> {
    const filter: Record<string, string> = opts.priceTypes?.length ? { $filter: opts.priceTypes.map(g => `ВидЦены_Key eq guid'${g}'`).join(' or ') } : {}
    // В 1С:КА два регистра цен: `ЦеныНоменклатуры25` (новое ценообразование) и прежний
    // `ЦеныНоменклатуры`. Тестовая база (2026-10-21): в первом записей нет — пробуем оба.
    // Пути по очереди: срез последних, затем наборы записей; что не сработало — в `tried`.
    const attempts: Array<{ via: PricesResult['via'], set: string, load: () => Promise<PriceRow[]> }> = []
    for (const set of PRICE_REGISTERS) {
      const slice = `${encodeURIComponent(set)}/SliceLast()`
      attempts.push(
        { via: 'slice', set, load: () => this.listPath<PriceRow>(slice, `${set}/SliceLast`, { ...filter }) },
        { via: 'records', set, load: () => this.recordSets(set) },
      )
    }
    const tried: string[] = []
    let rows: PriceRow[] | null = null
    let via: PricesResult['via'] = 'slice'
    let register: string = PRICE_REGISTERS[0]
    for (const a of attempts) {
      try {
        rows = await a.load()
        via = a.via
        register = a.set
        if (rows.length) break
        tried.push(`${a.set} ${a.via}: пусто`)
      }
      catch (e) {
        if (!(e instanceof OnecError) || (e.kind !== 'http' && e.kind !== 'contract')) throw e
        tried.push(`${a.set} ${a.via}: ${e.message}`)
      }
    }
    const currencies = await this.currencies()
    const vat = await this.vatByItem()
    const stats = emptyPriceStats()
    const items = mapPrices(rows ?? [], { currencies: currencies.map, vat: vat.map }, stats)
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
  async recordSets(set: string, pageSize = 200, maxPages = 2000): Promise<PriceRow[]> {
    const out: PriceRow[] = []
    for (let page = 0; page < maxPages; page++) {
      const sets = await this.list<{ RecordSet?: PriceRow[] }>(set, { $top: pageSize, $skip: page * pageSize })
      for (const rs of sets) out.push(...(rs.RecordSet ?? []))
      if (sets.length < pageSize) return out
    }
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
    return checked(Stock, mapStock(rows, warehouses.map, changedAt), 'stock')
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
  async vatByItem(): Promise<{ map: Map<string, number>, error?: string }> {
    try {
      const rates = await this.list<{ Ref_Key: string, Description?: string, Ставка?: number }>('Catalog_СтавкиНДС', {})
      const rate = new Map(rates.map(r => [r.Ref_Key.toLowerCase(), vatPercent(r.Ставка, r.Description)]))
      const items = await this.list<{ Ref_Key: string, СтавкаНДС_Key?: string }>('Catalog_Номенклатура', { $select: 'Ref_Key,СтавкаНДС_Key', $filter: 'IsFolder eq false' })
      return { map: new Map(items.flatMap((i) => {
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
export const PRICE_REGISTERS = ['InformationRegister_ЦеныНоменклатуры25', 'InformationRegister_ЦеныНоменклатуры'] as const

export interface PriceStats {
  read: number
  inactive: number
  /** Цена характеристики или упаковки — ЛК продаёт товар целиком. */
  variant: number
  noRef: number
  noCurrency: number
  noPrice: number
}
export const emptyPriceStats = (): PriceStats => ({ read: 0, inactive: 0, variant: 0, noRef: 0, noCurrency: 0, noPrice: 0 })

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
    const item = ref(r.Номенклатура_Key)!
    out.push({
      priceTypeGuid: ref(r.ВидЦены_Key)!,
      itemGuid: item,
      price: money(r.Цена),
      currency,
      vatRate: look.vat.get(item) ?? 0,
      changedAt: `${(r.Period ?? '2000-01-01T00:00:00').slice(0, 19)}${ONEC_TZ}`,
      deleted: false,
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
