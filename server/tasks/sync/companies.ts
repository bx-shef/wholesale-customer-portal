// Расписание: клиенты 1С → компании Б24 (docs/spec.md §4, раз в 5–15 минут).
// Без вебхука Б24 задача ничего не делает: ЛК без коробки (демо на моке) — штатный режим.
export default defineTask({
  meta: { name: 'sync:companies', description: 'Клиенты 1С → компании Битрикс24' },
  async run() {
    if (!readServerEnv().b24WebhookUrl) return { result: 'skipped: B24_WEBHOOK_URL is not set' }
    const run = await syncCompanies()
    return { result: { status: run.status, received: run.received, ...run.summary } }
  },
})
