// Расписание: прайс 1С по видам цен → база ЛК (docs/onec-contract.md §2.4, раз в 15 минут).
export default defineTask({
  meta: { name: 'sync:prices', description: 'Прайс 1С → база ЛК' },
  async run() {
    const run = await syncPrices()
    return { result: { status: run.status, received: run.received } }
  },
})
