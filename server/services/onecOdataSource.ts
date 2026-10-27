/**
 * 1С по OData в роли `useOnec()` (docs/onec-odata.md): каталог, картинки, цены и остатки — из
 * `ODataClient`, в форме и по правилам страниц контракта. Синхронизации ЛК (catalogSync) не знают,
 * какой транспорт под ними.
 *
 * У OData нет курсора `changedSince`, поэтому объект читается целиком один раз за прогон
 * (снимок держится `SNAPSHOT_TTL_MS`), а страницы «изменённого с момента» отдаёт
 * `snapshotPage`. Момент изменения товара ЛК ведёт сам по версии объекта 1С (`odata_version`).
 *
 * График доставки по OData не читается — его нет в 1С (#45): такие вызовы отвечают ошибкой, а не
 * подставляют мок — чужие данные в CRM хуже, чем отказ потока.
 */
import type { z } from 'zod'
import type { CatalogPage, ClientsPage, ClientT, ImageFileT, OrderCreated, OrderRequest, OrderStatusPage, OrderStatusRowT, TripsPage, TripT, ItemT, PriceT, PricesPage, SectionT, StockPage, StockT } from '../../shared/onec/schemas'
import { pageOfSorted, sortSnapshot, stampByVersion, type SortedSnapshot, type VersionMark } from '../utils/odataSnapshot'
import { OnecError, type ListParams } from './onec'
import type { ODataClient } from './onecOdata'
import { createOdataOrder, readOrderStatuses } from './onecOdataOrders'
import { readTrips, type TripStats } from './onecOdataTrips'
import { checkedClients, mapClients, readClientSources, readClientSourcesFor, type ClientStats, emptyClientStats } from './onecOdataClients'

/**
 * Сколько живёт прочитанный снимок после того, как дочитан: прогон синхронизации листает его
 * страницы за секунды. Снимок общий для всех вызовов метода с любыми `params` в этом окне.
 */
export const SNAPSHOT_TTL_MS = 2 * 60_000

/**
 * Потоки, которых по OData ещё нет (docs/onec-odata.md): в режиме `odata` расписание их не
 * запускает, а «Состояние системы» и оповещения не ждут от них прогонов.
 */
export const ODATA_UNSUPPORTED_FLOWS = ['schedule'] as const

/**
 * Каких потоков ждать не надо при этом окружении: в режиме `odata` — несделанных; заказов — пока не включён
 * `ONEC_ODATA_ORDERS` (заказы пишутся в 1С), рейсов — пока не включён `ONEC_ODATA_TRIPS` (документ
 * выпал из публикации OData). График доставки в 1С не ведётся (Excel, #45).
 */
export function unsupportedFlowsFor(env: { onecMock: boolean, onecMode: string, onecOdataOrders: boolean, onecOdataTrips: boolean, onecOdataImages?: boolean }): readonly string[] {
  if (env.onecMock || env.onecMode !== 'odata') return []
  // Картинки — пока не включён ONEC_ODATA_IMAGES: иначе поток «ещё не было» тревожил бы зря.
  return [...(env.onecOdataOrders ? [] : ['orders']), ...(env.onecOdataTrips ? [] : ['trips']), ...(env.onecOdataImages ? [] : ['images']), ...ODATA_UNSUPPORTED_FLOWS]
}

export interface VersionStore {
  get(kind: string): Map<string, VersionMark>
  put(kind: string, updates: Array<{ key: string } & VersionMark>): void
}

export interface OdataOnecOptions {
  /** Виды цен по наименованию (`ONEC_PRICE_TYPES`); пусто — все. */
  priceTypeNames?: string[]
  /** Склад заказа, если соглашение его не задаёт (`ONEC_STOCK_WAREHOUSES`, первый найденный). */
  warehouseNames?: string[]
  /** Запись заказов в 1С включена (`ONEC_ODATA_ORDERS`); тестовые заказы стенда — всегда. */
  ordersEnabled?: boolean
  /** Рейсы читаются (`ONEC_ODATA_TRIPS`): иначе `trips()` — отказ, а у заказов нет рейса. */
  tripsEnabled?: boolean
  now?: () => Date
  ttlMs?: number
  log?: (line: string) => void
}

type Memo<T> = { at: number | null, value: Promise<T> }

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

  private nowMs() {
    return (this.options.now?.() ?? new Date()).getTime()
  }

  /**
   * Снимок один на прогон: первая страница читает 1С, следующие — из памяти. Срок считается от
   * конца загрузки (`at`), пока снимок читается — он общий для всех ждущих. Ошибка не кэшируется.
   */
  private snapshot<T>(name: string, load: () => Promise<T>): Promise<T> {
    const hit = this.memo.get(name) as Memo<T> | undefined
    if (hit && (hit.at === null || this.nowMs() - hit.at < (this.options.ttlMs ?? SNAPSHOT_TTL_MS))) return hit.value
    const entry: Memo<T> = { at: null, value: load() }
    this.memo.set(name, entry)
    entry.value.then(
      () => { entry.at = this.nowMs() },
      () => { if (this.memo.get(name) === entry) this.memo.delete(name) },
    )
    return entry.value
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
      return { sections, sorted: sortSnapshot(stamped.rows, i => i.guid.toLowerCase()) } satisfies { sections: SectionT[], sorted: SortedSnapshot<ItemT> }
    })
    return { sections: (params.page ?? 1) === 1 ? snap.sections : [], ...pageOfSorted(snap.sorted, params) }
  }

  async prices(params: ListParams = {}): Promise<z.infer<typeof PricesPage>> {
    const all = await this.snapshot('prices', async () => {
      const priceTypes = await this.priceTypeGuids()
      const r = await this.client.prices({ priceTypes })
      // Момент — по версии строки, а не по `Period`: цену, введённую задним числом, курсор по
      // `Period` пропустил бы навсегда (ревью PR #62). Версия — всё, что видит клиент.
      const key = (p: PriceT) => `${p.priceTypeGuid}|${p.itemGuid}`
      const stamped = stampByVersion(
        r.items.map(p => ({ key: key(p), version: `${p.price}|${p.currency}|${p.vatRate}|${p.deleted ? 1 : 0}|${p.changedAt}`, row: p })),
        this.versions.get('price'),
        this.nowIso(),
      )
      this.versions.put('price', stamped.updates)
      this.options.log?.(`[onec:odata] prices: ${r.items.length} rows, ${stamped.updates.length} changed, zero ${r.stats.zero}${r.tried.length ? `; tried: ${r.tried.join(' | ')}` : ''}`)
      return sortSnapshot(stamped.rows, key)
    })
    return pageOfSorted(all, params)
  }

  async stock(params: ListParams = {}): Promise<z.infer<typeof StockPage>> {
    const all = await this.snapshot('stock', async () => sortSnapshot<StockT>(await this.client.stock(), s => `${s.itemGuid}|${s.warehouseGuid}`))
    return pageOfSorted(all, params)
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

  /** Клиенты (§2.1): партнёры с соглашениями, моменты — по версии клиента целиком (onecOdataClients). */
  async clients(params: ListParams = {}): Promise<z.infer<typeof ClientsPage>> {
    const all = await this.snapshot('clients', async () => {
      const src = await readClientSources(this.client)
      const stats: ClientStats = emptyClientStats()
      const rows = checkedClients(mapClients(src, minskDay(this.options.now?.() ?? new Date()), stats))
      const stamped = stampByVersion(rows.map(r => ({ key: r.client.guid, version: r.version, row: r.client })), this.versions.get('client'), this.nowIso())
      this.versions.put('client', stamped.updates)
      this.options.log?.(`[onec:odata] clients: ${stats.clients}, ${stamped.updates.length} changed, no agreement ${stats.noAgreement}, several ${stats.manyAgreements}`)
      return sortSnapshot<ClientT>(stamped.rows, c => c.guid)
    })
    return pageOfSorted(all, params)
  }

  /** Один клиент по GUID (решение владельца 2026-10-22): точечные запросы, без снимка всех партнёров. */
  async clientByGuid(guid: string): Promise<ClientT | null> {
    const src = await readClientSourcesFor(this.client, guid)
    if (!src) return null
    const row = checkedClients(mapClients(src, minskDay(this.options.now?.() ?? new Date())))[0]
    if (!row) return null
    const stamped = stampByVersion([{ key: row.client.guid, version: row.version, row: row.client }], this.versions.get('client'), this.nowIso())
    this.versions.put('client', stamped.updates)
    return stamped.rows[0]!
  }

  /** Заказ по заявке ЛК (§2.6): `Document_ЗаказКлиента`, повтор без дубля (onecOdataOrders). */
  createOrder(input: z.input<typeof OrderRequest>): Promise<z.infer<typeof OrderCreated>> {
    return createOdataOrder(this.client, input, { warehouseNames: this.options.warehouseNames ?? [], enabled: this.options.ordersEnabled === true, now: this.options.now?.() })
  }

  /** Статусы заказов ЛК (§2.7): момент — по версии документа. */
  async orderStatus(params: ListParams = {}): Promise<z.infer<typeof OrderStatusPage>> {
    const all = await this.snapshot('orders', async () => {
      const rows = await readOrderStatuses(this.client, this.options.now?.() ?? new Date())
      // Рейс заказа — из рейсов (в документе заказа его нет): позднейший по плановому началу.
      if (this.options.tripsEnabled) {
        const tripOf = new Map<string, { guid: string, at: string }>()
        // Рейсы не прочитались — прогон статусов падает целиком: с `tripGuid: null` ЛК стёр бы у
        // заказов уже известные рейсы (applyOnecStatuses ставит рейс из строки как есть).
        for (const t of (await this.tripsSnapshot()).rows) {
          for (const o of t.orders) {
            const prev = tripOf.get(o.orderGuid)
            if (!t.deleted && (!prev || t.plannedStart > prev.at)) tripOf.set(o.orderGuid, { guid: t.guid, at: t.plannedStart })
          }
        }
        for (const r of rows) {
          r.row.tripGuid = tripOf.get(r.row.orderGuid)?.guid ?? null
          if (r.version) r.version = `${r.version}|${r.row.tripGuid ?? ''}`
        }
      }
      return sortSnapshot<OrderStatusRowT>(this.stampOrders(rows), o => o.orderGuid)
    })
    return pageOfSorted(all, params)
  }
  async deliverySchedule(): Promise<never> { return notYet('deliverySchedule') }
  private stampOrders(rows: Array<{ row: OrderStatusRowT, version: string }>): OrderStatusRowT[] {
    const stamped = stampByVersion(rows.map(r => ({ key: r.row.orderGuid, version: r.version, row: r.row })), this.versions.get('order'), this.nowIso())
    this.versions.put('order', stamped.updates)
    return stamped.rows
  }

  /** Рейсы (§2.9): задания на перевозку за окно, момент — по версии документа и его заказов. */
  async trips(params: ListParams = {}): Promise<z.infer<typeof TripsPage>> {
    return pageOfSorted(await this.tripsSnapshot(), params)
  }

  private tripsSnapshot() {
    if (!this.options.tripsEnabled) return Promise.reject(new OnecError('http', '1C OData trips: off (ONEC_ODATA_TRIPS) — document is not published yet', 501))
    return this.snapshot('trips', async () => {
      const stats: TripStats = { read: 0, noPlan: 0, broken: 0, ordersMissing: 0 }
      const rows = await readTrips(this.client, this.options.now?.() ?? new Date(), stats)
      const stamped = stampByVersion(rows.map(r => ({ key: r.trip.guid, version: r.version, row: r.trip })), this.versions.get('trip'), this.nowIso())
      this.versions.put('trip', stamped.updates)
      this.options.log?.(`[onec:odata] trips: ${stats.read} read, ${rows.length} ok, no plan ${stats.noPlan}, broken ${stats.broken}, orders not found ${stats.ordersMissing}`)
      return sortSnapshot<TripT>(stamped.rows, t => t.guid)
    })
  }
}

function notYet(method: string): never {
  // 501 не повторяется (OnecError.retryable): поток падает сразу и виден в «Состоянии системы».
  throw new OnecError('http', `1C OData: ${method} is not implemented yet (docs/onec-odata.md)`, 501)
}

/** Сегодня по Минску (ГГГГ-ММ-ДД): соглашения действуют по датам 1С, а 1С живёт по Минску. */
export function minskDay(d: Date): string {
  return new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 10)
}
