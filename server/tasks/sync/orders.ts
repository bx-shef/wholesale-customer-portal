// Расписание: заявки ЛК — досылка в CRM, подтверждения → заказы 1С, статусы 1С → заявки и сделки.
export default defineTask({
  meta: { name: 'sync:orders', description: 'Заявки ЛК ↔ CRM ↔ 1С' },
  async run() {
    if (!readServerEnv().b24WebhookUrl) return { result: 'skipped: B24_WEBHOOK_URL is not set' }
    return { result: await runOrderSync() }
  },
})
