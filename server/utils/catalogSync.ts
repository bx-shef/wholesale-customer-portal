/**
 * Каталог и остатки из 1С в индекс (server/utils/catalog.ts) по курсору `changedSince`.
 * Расписание — server/tasks/sync/{catalog,stock}.ts; первый прогон — при старте (plugins/catalogWarmup.ts).
 */
import { access, mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ItemT, PriceT, SectionT, StockT } from '../../shared/onec/schemas'
import { fetchMissingImages } from './imageStore'
import { createCatalogStore, type CatalogStore } from './catalog'
import { createPriceStore, type PriceStore } from './prices'
import { runFlow, sqliteSyncStore, type SyncRun } from './onecSync'
import { shouldPruneStock } from './odataSnapshot'

let store: CatalogStore | undefined
export function useCatalog(): CatalogStore {
  store ??= createCatalogStore(useDb(), { hiddenSections: () => readServerEnv().catalogHiddenSections })
  return store
}

let prices: PriceStore | undefined
/** Прайс в базе ЛК (§2.4): цены клиенту — отсюда, без запросов к 1С. */
export function usePrices(): PriceStore {
  prices ??= createPriceStore(useDb())
  return prices
}

const running: Record<string, Promise<SyncRun> | undefined> = {}
/** Одновременно — один запуск на поток: расписание, старт и ручной вызов не пишут вдвоём. */
function once(name: string, job: () => Promise<SyncRun>): Promise<SyncRun> {
  running[name] ??= job().finally(() => {
    running[name] = undefined
  })
  return running[name]!
}

export function syncCatalog(): Promise<SyncRun> {
  return once('catalog', async () => {
    const onec = useOnec()
    const catalog = useCatalog()
    // Разделы приходят только вместе со страницами каталога — копим их рядом с товарами.
    const sections = new Map<string, SectionT>()
    const run = await runFlow<ItemT>({
      name: 'catalog',
      key: i => i.guid.toLowerCase(),
      load: async (p) => {
        const page = await onec.catalog(p)
        for (const s of page.sections) sections.set(s.guid.toLowerCase(), s)
        return page
      },
      consume: async items => catalog.saveCatalog([...sections.values()], items),
    }, sqliteSyncStore(useDb()))
    if (run.status === 'failed') console.error(`[sync:catalog] ${run.error}`)
    // Картинки — после каталога и не мешая ему: сбой картинок каталог не роняет.
    if (imagesEnabled(readServerEnv())) await syncImages().catch(e => console.error(`[sync:images] ${(e as Error).message}`))
    return run
  })
}

/**
 * Докачивать ли картинки после каталога: по OData — только с `ONEC_ODATA_IMAGES=true`.
 * На тестовой 1С файлы приходят пустыми (2026-10-26): без флага было бы 300 пустых запросов в сутки.
 */
export function imagesEnabled(env: { onecMock: boolean, onecMode: string, onecOdataImages: boolean }): boolean {
  return env.onecMock || env.onecMode !== 'odata' || env.onecOdataImages
}

/** Докачать из 1С картинки, которых ещё нет на томе (§2.8); за прогон — не больше IMAGES_PER_RUN. */
export async function syncImages() {
  const dir = join(readServerEnv().dataDir, 'images')
  await mkdir(dir, { recursive: true })
  const onec = useOnec()
  const result = await fetchMissingImages(useCatalog().imageRefs(), {
    fs: {
      exists: name => access(join(dir, name)).then(() => true, () => false),
      // Сначала во временный файл: оборванная запись не станет «готовой» картинкой.
      write: async (name, bytes) => {
        const tmp = join(dir, `.${name}.tmp`)
        await writeFile(tmp, bytes)
        await rename(tmp, join(dir, name))
      },
    },
    load: id => onec.image(id),
  })
  if (result.saved || result.failed.length || result.left) {
    console.info(`[sync:images] saved ${result.saved}, failed ${result.failed.length}, left ${result.left}`)
    for (const f of result.failed.slice(0, 5)) console.warn(`[sync:images] ${f.id}: ${f.reason}`)
  }
  return result
}

/** Прайс по изменениям (§2.4): раз в 15 минут, ключ — «вид цен × товар». */
export function syncPrices(): Promise<SyncRun> {
  return once('prices', async () => {
    const onec = useOnec()
    const store = usePrices()
    const run = await runFlow<PriceT>({
      name: 'prices',
      key: p => `${p.priceTypeGuid.toLowerCase()}|${p.itemGuid.toLowerCase()}`,
      load: p => onec.prices(p),
      consume: async rows => store.save(rows),
    }, sqliteSyncStore(useDb()))
    if (run.status === 'failed') console.error(`[sync:prices] ${run.error}`)
    return run
  })
}

export function syncStock(): Promise<SyncRun> {
  return once('stock', async () => {
    const onec = useOnec()
    const catalog = useCatalog()
    const storedRows = catalog.stockRows()
    const run = await runFlow<StockT>({
      name: 'stock',
      key: s => `${s.itemGuid.toLowerCase()}|${s.warehouseGuid.toLowerCase()}`,
      load: p => onec.stock(p),
      consume: async rows => catalog.saveStock(rows),
    }, sqliteSyncStore(useDb()))
    if (run.status === 'failed') console.error(`[sync:stock] ${run.error}`)
    applyStockSnapshot(run, { snapshot: !!onec.stockIsSnapshot, storedRows, catalog })
    return run
  })
}

/**
 * После прогона остатков снимком (OData): строки старше снимка — товар ушёл со склада. Правило —
 * `shouldPruneStock`; не прошло — старые строки остаются, в логе предупреждение. Возвращает число удалённых.
 */
export function applyStockSnapshot(
  run: Pick<SyncRun, 'status' | 'received' | 'cursorTo'>,
  o: { snapshot: boolean, storedRows: number, catalog: Pick<CatalogStore, 'pruneStockBefore'> },
): number {
  if (shouldPruneStock({ snapshot: o.snapshot, status: run.status, received: run.received, cursorTo: run.cursorTo, storedRows: o.storedRows })) {
    const gone = o.catalog.pruneStockBefore(run.cursorTo!)
    if (gone) console.info(`[sync:stock] pruned ${gone} rows not in snapshot`)
    return gone
  }
  if (o.snapshot && run.status === 'done') console.warn(`[sync:stock] snapshot of ${run.received} rows vs ${o.storedRows} stored — old rows kept`)
  return 0
}
