/**
 * Каталог и остатки из 1С в индекс (server/utils/catalog.ts) по курсору `changedSince`.
 * Расписание — server/tasks/sync/{catalog,stock}.ts; первый прогон — при старте (plugins/catalogWarmup.ts).
 */
import type { ItemT, SectionT, StockT } from '../../shared/onec/schemas'
import { createCatalogStore, type CatalogStore } from './catalog'
import { createPriceCache } from './prices'
import { runFlow, sqliteSyncStore, type SyncRun } from './onecSync'

let store: CatalogStore | undefined
export function useCatalog(): CatalogStore {
  store ??= createCatalogStore(useDb())
  return store
}

let prices: ReturnType<typeof createPriceCache> | undefined
export function usePrices() {
  prices ??= createPriceCache(async (clientGuid, items) => useOnec().prices({ clientGuid, items }))
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
    const sections: SectionT[] = []
    const run = await runFlow<ItemT>({
      name: 'catalog',
      key: i => i.guid.toLowerCase(),
      load: async (p) => {
        const page = await onec.catalog(p)
        sections.push(...page.sections)
        return page
      },
      consume: async items => catalog.saveCatalog(sections, items),
    }, sqliteSyncStore(useDb()))
    if (run.status === 'failed') console.error(`[sync:catalog] ${run.error}`)
    return run
  })
}

export function syncStock(): Promise<SyncRun> {
  return once('stock', async () => {
    const onec = useOnec()
    const catalog = useCatalog()
    const run = await runFlow<StockT>({
      name: 'stock',
      key: s => `${s.itemGuid.toLowerCase()}|${s.warehouseGuid.toLowerCase()}`,
      load: p => onec.stock(p),
      consume: async rows => catalog.saveStock(rows),
    }, sqliteSyncStore(useDb()))
    if (run.status === 'failed') console.error(`[sync:stock] ${run.error}`)
    return run
  })
}
