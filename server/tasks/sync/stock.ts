// Расписание: остатки 1С → индекс ЛК (docs/spec.md §4; частота — SYNC_*_EVERY_MIN).
export default defineTask({
  meta: { name: 'sync:stock', description: 'Остатки 1С → индекс ЛК' },
  async run() {
    // Расписание будит раз в минуту; частота — SYNC_*_EVERY_MIN, пауза — на «Состоянии системы».
    const skip = autoSyncSkip('stock', { db: useDb(), every: readServerEnv().syncEvery })
    if (skip) return { result: skip }
    const run = await syncStock()
    return { result: { status: run.status, received: run.received } }
  },
})
