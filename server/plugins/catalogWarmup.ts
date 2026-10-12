// Первый прогон каталога и остатков при старте: иначе свежий сервер час показывал бы пустой каталог.
// Без 1С (нет ни мока, ни ONEC_URL) — пропускаем: ЛК поднимается и без неё.
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  const env = readServerEnv()
  if (!env.onecMock && !(env.onecUrl && env.onecToken)) return
  setTimeout(() => {
    syncCatalog()
      .then(() => syncStock())
      .catch(e => console.error(`[catalog] warmup: ${(e as Error).message}`))
  }, 1000)
})
