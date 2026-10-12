// Запуск синхронизации заявок: один на процесс (расписание и ручной вызов не идут вдвоём).
import type { OrderStatusRowT } from '../../shared/onec/schemas'
import { applyOnecStatuses, syncOrders } from './orderSync'
import { runFlow, sqliteSyncStore } from './onecSync'

let running: Promise<unknown> | undefined

export function runOrderSync() {
  running ??= (async () => {
    const deps = {
      orders: useOrderStore(),
      clients: useClientStore(),
      b24: useB24Orders(),
      createOnecOrder: (o: Parameters<ReturnType<typeof useOnec>['createOrder']>[0]) => useOnec().createOrder(o),
    }
    const summary = await syncOrders(deps)
    let applied = 0
    const onec = useOnec()
    const run = await runFlow<OrderStatusRowT>({
      name: 'orders',
      key: r => r.orderGuid.toLowerCase(),
      load: p => onec.orderStatus(p),
      consume: async (rows) => {
        applied = await applyOnecStatuses(rows, deps)
      },
    }, sqliteSyncStore(useDb()))
    if (run.status === 'failed') console.error(`[sync:orders] statuses: ${run.error}`)
    return { ...summary, statuses: applied, statusRun: run.status }
  })().finally(() => {
    running = undefined
  })
  return running
}
