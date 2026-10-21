// Расписание: клиенты 1С → компании Б24 (docs/spec.md §4, раз в 5–15 минут).
// Без установленного приложения Б24 задача ничего не делает: ЛК без коробки (демо на моке) — штатный режим.
export default defineTask({
  meta: { name: 'sync:companies', description: 'Клиенты 1С → компании Битрикс24' },
  async run() {
    if (onecUnsupportedFlows().includes('clients')) return { result: 'skipped: not available over OData yet' }
    if (!b24Configured()) return { result: 'skipped: Bitrix24 app is not installed' }
    const run = await syncCompanies()
    return { result: { status: run.status, received: run.received, ...run.summary } }
  },
})
