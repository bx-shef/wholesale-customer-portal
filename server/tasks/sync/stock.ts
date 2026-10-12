// Расписание: остатки 1С → индекс ЛК (docs/spec.md §4, раз в 5 минут).
export default defineTask({
  meta: { name: 'sync:stock', description: 'Остатки 1С → индекс ЛК' },
  async run() {
    const run = await syncStock()
    return { result: { status: run.status, received: run.received } }
  },
})
