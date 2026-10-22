// Запуск синхронизации заявок: один на процесс (расписание и ручной вызов не идут вдвоём).
import type { OrderRequestT, OrderStatusRowT } from '../../shared/onec/schemas'
import { applyOnecStatuses, reportToCrm, syncOrders } from './orderSync'
import { runFlow, sqliteSyncStore } from './onecSync'

let running: Promise<unknown> | undefined

export function runOrderSync() {
  running ??= (async () => {
    // OData без ONEC_ODATA_ORDERS: в 1С не пишем и статусы не читаем, CRM-часть работает.
    const onecOrders = !onecUnsupportedFlows().includes('orders')
    const deps = {
      onecOrders,
      orders: useOrderStore(),
      clients: useClientStore(),
      b24: useB24Orders(),
      createOnecOrder: (o: OrderRequestT) => useOnec().createOrder(o),
      schedules: () => cachedSchedules(),
      companyTitle: async (id: number) => (await useAccessDirectory().getCompany(id))?.title ?? null,
    }
    const summary = await syncOrders(deps)
    if (!onecOrders) return { ...summary, statuses: 0, statusRun: 'skipped' as const }
    // Статусы 1С → база (курсор зависит только от записи в базу), затем сразу — в сделки.
    let applied = 0
    const onec = useOnec()
    const run = await runFlow<OrderStatusRowT>({
      name: 'orders',
      key: r => r.orderGuid.toLowerCase(),
      load: p => onec.orderStatus(p),
      consume: async (rows) => {
        applied = applyOnecStatuses(rows, deps)
      },
    }, sqliteSyncStore(useDb()))
    if (run.status === 'failed') console.error(`[sync:orders] statuses: ${run.error}`)
    if (applied) summary.reported += await reportToCrm(deps, () => deps.b24.stages())
    return { ...summary, statuses: applied, statusRun: run.status }
  })().finally(() => {
    running = undefined
  })
  return running
}
