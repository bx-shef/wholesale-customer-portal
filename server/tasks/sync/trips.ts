// Расписание: задания на перевозку из 1С → база ЛК (docs/onec-contract.md §2.9, раз в 10 минут).
export default defineTask({
  meta: { name: 'sync:trips', description: 'Задания на перевозку 1С → база ЛК' },
  async run() {
    const run = await syncTrips()
    return { result: { status: run.status, received: run.received } }
  },
})
