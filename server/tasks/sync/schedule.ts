// Расписание: график доставки по регионам из 1С → база ЛК (docs/onec-contract.md §2.8, раз в час).
export default defineTask({
  meta: { name: 'sync:schedule', description: 'График доставки 1С → база ЛК' },
  async run() {
    const run = await syncDeliverySchedule()
    return { result: { status: run.status, received: run.received } }
  },
})
