/**
 * Синхронизация доставки из 1С: график по регионам (§2.8) — целиком, раз в час; задания на
 * перевозку (§2.9) — по курсору, раз в 10 минут. Расписание — server/tasks/sync/{schedule,trips}.ts.
 */
import type { TripT } from '../../shared/onec/schemas'
import { createDeliveryStore, type DeliveryStore } from './delivery'
import { runFlow, sqliteSyncStore, type SyncRun } from './onecSync'

let store: DeliveryStore | undefined
export function useDelivery(): DeliveryStore {
  store ??= createDeliveryStore(useDb())
  return store
}

const running: Record<string, Promise<SyncRun> | undefined> = {}
function once(name: string, job: () => Promise<SyncRun>): Promise<SyncRun> {
  running[name] ??= job().finally(() => {
    running[name] = undefined
  })
  return running[name]!
}

/** График без курсора: справочник маленький, 1С отдаёт его целиком, запуск всё равно в журнале. */
export function syncDeliverySchedule(): Promise<SyncRun> {
  return once('schedule', async () => {
    const journal = sqliteSyncStore(useDb())
    const run: SyncRun = { flow: 'schedule', status: 'running', startedAt: new Date().toISOString(), finishedAt: null, cursorFrom: null, cursorTo: null, received: 0, error: null }
    await journal.saveRun(run)
    try {
      const { items } = await useOnec().deliverySchedule()
      useDelivery().saveSchedules(items)
      run.received = items.length
      run.status = 'done'
    }
    catch (e) {
      run.status = 'failed'
      run.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      console.error(`[sync:schedule] ${run.error}`)
    }
    run.finishedAt = new Date().toISOString()
    await journal.saveRun(run)
    return run
  })
}

export function syncTrips(): Promise<SyncRun> {
  return once('trips', async () => {
    const onec = useOnec()
    const run = await runFlow<TripT>({
      name: 'trips',
      key: t => t.guid.toLowerCase(),
      load: p => onec.trips(p),
      consume: async rows => useDelivery().saveTrips(rows),
    }, sqliteSyncStore(useDb()))
    if (run.status === 'failed') console.error(`[sync:trips] ${run.error}`)
    return run
  })
}
