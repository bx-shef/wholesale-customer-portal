// Расписание: задания на перевозку из 1С → база ЛК (docs/onec-contract.md §2.9; частота — SYNC_*_EVERY_MIN).
export default defineTask({
  meta: { name: 'sync:trips', description: 'Задания на перевозку 1С → база ЛК' },
  async run() {
    // Расписание будит раз в минуту; частота — SYNC_*_EVERY_MIN, пауза — на «Состоянии системы».
    const skip = autoSyncSkip('trips', { db: useDb(), every: readServerEnv().syncEvery })
    if (skip) return { result: skip }
    if (onecUnsupportedFlows().includes('trips')) return { result: 'skipped: not available over OData yet' }
    const run = await syncTrips()
    return { result: { status: run.status, received: run.received } }
  },
})
