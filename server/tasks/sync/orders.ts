// Расписание: заявки ЛК — досылка в CRM, подтверждения → заказы 1С, статусы 1С → заявки и сделки.
export default defineTask({
  meta: { name: 'sync:orders', description: 'Заявки ЛК ↔ CRM ↔ 1С' },
  async run() {
    if (!b24Configured()) return { result: 'skipped: Bitrix24 app is not installed' }
    return { result: await runOrderSync() }
  },
})
