// Расписание: прайс 1С по видам цен → база ЛК (docs/onec-contract.md §2.4; частота — SYNC_*_EVERY_MIN).
export default defineTask({
  meta: { name: 'sync:prices', description: 'Прайс 1С → база ЛК' },
  async run() {
    // Расписание будит раз в минуту; частота — SYNC_*_EVERY_MIN, пауза — на «Состоянии системы».
    const skip = autoSyncSkip('prices', { db: useDb(), every: readServerEnv().syncEvery })
    if (skip) return { result: skip }
    const run = await syncPrices()
    return { result: { status: run.status, received: run.received } }
  },
})
