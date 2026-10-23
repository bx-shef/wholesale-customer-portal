// Расписание: заявки ЛК — досылка в CRM, подтверждения → заказы 1С, статусы 1С → заявки и сделки.
export default defineTask({
  meta: { name: 'sync:orders', description: 'Заявки ЛК ↔ CRM ↔ 1С' },
  async run() {
    // Расписание будит раз в минуту; частота — SYNC_*_EVERY_MIN, пауза — на «Состоянии системы».
    const skip = autoSyncSkip('orders', { db: useDb(), every: readServerEnv().syncEvery })
    if (skip) return { result: skip }
    if (!b24Configured()) return { result: 'skipped: Bitrix24 app is not installed' }
    return { result: await runOrderSync() }
  },
})
