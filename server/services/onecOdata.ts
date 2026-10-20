/**
 * Клиент 1С по стандартному OData (docs/onec-odata.md): собирает из объектов 1С те же формы, что
 * контракт `shared/onec/schemas.ts`, поэтому синхронизации и страницы ЛК от транспорта не зависят.
 *
 * Сейчас — каталог (`Catalog_Номенклатура`). Сопоставление полей и открытые вопросы — в документе.
 * Ответ проверяется схемой контракта: «прошло здесь» значит «ЛК прочитает».
 */
import type { z } from 'zod'
import { CatalogPage, PAGE_SIZE_MAX, type ItemT, type SectionT } from '../../shared/onec/schemas'
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
  async list<T>(set: string, query: Record<string, string | number>): Promise<T[]> {
    const qs = Object.entries({ ...query, $format: 'json' })
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
    const url = `${this.base}/${encodeURIComponent(set)}?${qs}`
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
    if (!res.ok) throw new OnecError('http', `1C OData ${set}: HTTP ${res.status}`, res.status)
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
}
