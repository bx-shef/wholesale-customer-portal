// Расписание: график доставки по регионам из 1С → база ЛК (docs/onec-contract.md §2.8; частота — SYNC_*_EVERY_MIN).
export default defineTask({
  meta: { name: 'sync:schedule', description: 'График доставки 1С → база ЛК' },
  async run() {
    // Расписание будит раз в минуту; частота — SYNC_*_EVERY_MIN, пауза — на «Состоянии системы».
    const skip = autoSyncSkip('schedule', { db: useDb(), every: readServerEnv().syncEvery })
    if (skip) return { result: skip }
    if (onecUnsupportedFlows().includes('schedule')) return { result: 'skipped: not available over OData yet' }
    const run = await syncDeliverySchedule()
    return { result: { status: run.status, received: run.received } }
  },
})
