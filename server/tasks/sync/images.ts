// Расписание: картинки товаров из 1С → том /data/images (частота — SYNC_IMAGES_EVERY_MIN).
export default defineTask({
  meta: { name: 'sync:images', description: 'Картинки товаров 1С → том' },
  async run() {
    const skip = autoSyncSkip('images', { db: useDb(), every: readServerEnv().syncEvery })
    if (skip) return { result: skip }
    const run = await syncImages()
    return { result: { status: run.status, received: run.received } }
  },
})
