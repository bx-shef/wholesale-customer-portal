// Расписание: каталог 1С → индекс ЛК (docs/spec.md §4; частота — SYNC_*_EVERY_MIN).
export default defineTask({
  meta: { name: 'sync:catalog', description: 'Каталог 1С → индекс ЛК' },
  async run() {
    // Расписание будит раз в минуту; частота — SYNC_*_EVERY_MIN, пауза — на «Состоянии системы».
    const skip = autoSyncSkip('catalog', { db: useDb(), every: readServerEnv().syncEvery })
    if (skip) return { result: skip }
    const run = await syncCatalog()
    return { result: { status: run.status, received: run.received } }
  },
})
