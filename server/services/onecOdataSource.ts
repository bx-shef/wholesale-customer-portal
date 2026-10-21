/**
 * 1С по OData в роли `useOnec()` (docs/onec-odata.md): каталог, картинки, цены и остатки — из
 * `ODataClient`, в форме и по правилам страниц контракта. Синхронизации ЛК (catalogSync) не знают,
 * какой транспорт под ними.
 *
 * У OData нет курсора `changedSince`, поэтому объект читается целиком один раз за прогон
 * (снимок держится `SNAPSHOT_TTL_MS`), а страницы «изменённого с момента» отдаёт
 * `snapshotPage`. Момент изменения товара ЛК ведёт сам по версии объекта 1С (`odata_version`).
 *
 * Клиенты, заказы, рейсы и график по OData ещё не сделаны: такие вызовы отвечают ошибкой, а не
 * подставляют мок — чужие данные в CRM хуже, чем отказ потока.
 */
import type { z } from 'zod'
import type { CatalogPage, ImageFileT, PriceT, PricesPage, StockPage, StockT } from '../../shared/onec/schemas'
import { snapshotPage, stampByVersion, type SnapshotParams, type VersionMark } from '../utils/odataSnapshot'
import { OnecError, type ListParams } from './onec'
import type { ODataClient } from './onecOdata'

/** Сколько живёт прочитанный снимок: прогон синхронизации листает его страницы за секунды. */
export const SNAPSHOT_TTL_MS = 2 * 60_000

export interface VersionStore {
  get(kind: string): Map<string, VersionMark>
  put(kind: string, updates: Array<{ key: string } & VersionMark>): void
}

export interface OdataOnecOptions {
  /** Виды цен по наименованию (`ONEC_PRICE_TYPES`); пусто — все. */
  priceTypeNames?: string[]
  now?: () => Date
  ttlMs?: number
  log?: (line: string) => void
}

type Memo<T> = { at: number, value: Promise<T> }

export class OdataOnec {
  /** Остатки приходят снимком: строки, которых нет в снимке, в ЛК надо обнулить (catalogSync). */
  readonly stockIsSnapshot = true
  private readonly memo = new Map<string, Memo<unknown>>()

  constructor(
    private readonly client: ODataClient,
    private readonly versions: VersionStore,
    private readonly options: OdataOnecOptions = {},
  ) {}

  private nowIso() {
    return (this.options.now?.() ?? new Date()).toISOString()
  }

  /** Снимок один на прогон: первая страница читает 1С, следующие — из памяти. Ошибка не кэшируется. */
  private snapshot<T>(name: string, load: () => Promise<T>): Promise<T> {
    const t = (this.options.now?.() ?? new Date()).getTime()
    const hit = this.memo.get(name) as Memo<T> | undefined
    if (hit && t - hit.at < (this.options.ttlMs ?? SNAPSHOT_TTL_MS)) return hit.value
    const value = load()
    this.memo.set(name, { at: t, value })
    value.catch(() => this.memo.delete(name))
    return value
  }

  async catalog(params: ListParams = {}): Promise<z.infer<typeof CatalogPage>> {
    const snap = await this.snapshot('catalog', async () => {
      const { sections, items } = await this.client.catalogSnapshot()
      const stamped = stampByVersion(
        items.map(i => ({ key: i.item.guid.toLowerCase(), version: i.version, row: i.item })),
        this.versions.get('item'),
        this.nowIso(),
      )
      this.versions.put('item', stamped.updates)
      this.options.log?.(`[onec:odata] catalog: ${items.length} items, ${stamped.updates.length} changed`)
      return { sections, items: stamped.rows }
    })
    const page = snapshotPage(snap.items, i => i.guid.toLowerCase(), params as SnapshotParams)
    return { sections: (params.page ?? 1) === 1 ? snap.sections : [], ...page }
  }

  async prices(params: ListParams = {}): Promise<z.infer<typeof PricesPage>> {
    const all = await this.snapshot('prices', async () => {
      const priceTypes = await this.priceTypeGuids()
      const r = await this.client.prices({ priceTypes })
      this.options.log?.(`[onec:odata] prices: ${r.items.length} rows, zero ${r.stats.zero}${r.tried.length ? `; tried: ${r.tried.join(' | ')}` : ''}`)
      return r.items
    })
    return snapshotPage<PriceT>(all, p => `${p.priceTypeGuid}|${p.itemGuid}`, params as SnapshotParams)
  }

  async stock(params: ListParams = {}): Promise<z.infer<typeof StockPage>> {
    const all = await this.snapshot('stock', () => this.client.stock())
    return snapshotPage<StockT>(all, s => `${s.itemGuid}|${s.warehouseGuid}`, params as SnapshotParams)
  }

  image(id: string): Promise<ImageFileT> {
    return this.client.image(id)
  }

  /** Наименования видов цен из окружения → GUID; не нашли ни одного — честная ошибка, а не «все». */
  private async priceTypeGuids(): Promise<string[] | undefined> {
    const names = (this.options.priceTypeNames ?? []).map(n => n.trim().toLowerCase()).filter(Boolean)
    if (!names.length) return undefined
    const { map } = await this.client.names('Catalog_ВидыЦен')
    const guids = [...map].filter(([, name]) => names.includes(name.trim().toLowerCase())).map(([g]) => g)
    if (!guids.length) throw new OnecError('contract', `1C OData: price types not found: ${names.join(', ')}`)
    return guids
  }

  async clients(_params?: ListParams): Promise<never> { return notYet('clients') }
  async createOrder(_input?: unknown): Promise<never> { return notYet('createOrder') }
  async orderStatus(_params?: ListParams): Promise<never> { return notYet('orderStatus') }
  async deliverySchedule(): Promise<never> { return notYet('deliverySchedule') }
  async trips(_params?: ListParams): Promise<never> { return notYet('trips') }
}

function notYet(method: string): never {
  // 501 не повторяется (OnecError.retryable): поток падает сразу и виден в «Состоянии системы».
  throw new OnecError('http', `1C OData: ${method} is not implemented yet (docs/onec-odata.md)`, 501)
}
