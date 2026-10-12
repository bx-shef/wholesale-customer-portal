// Расписание: каталог 1С → индекс ЛК (docs/spec.md §4, раз в час).
export default defineTask({
  meta: { name: 'sync:catalog', description: 'Каталог 1С → индекс ЛК' },
  async run() {
    const run = await syncCatalog()
    return { result: { status: run.status, received: run.received } }
  },
})
