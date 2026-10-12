// Первый прогон каталога и остатков при старте: иначе свежий сервер час показывал бы пустой каталог.
// Без 1С (нет ни мока, ни ONEC_URL) — пропускаем: ЛК поднимается и без неё.
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  const env = readServerEnv()
  if (!env.onecMock && !(env.onecUrl && env.onecToken)) return
  setTimeout(() => {
    // Остатки — только поверх каталога: без товаров в индексе они не сохраняются.
    syncCatalog()
      .then(run => (run.status === 'done' ? syncStock() : undefined))
      .catch(e => console.error(`[catalog] warmup: ${(e as Error).message}`))
  }, 1000).unref()
})
