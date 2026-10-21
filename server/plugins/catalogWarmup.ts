// Первый прогон каталога, остатков и прайса при старте: иначе свежий сервер час показывал бы пустой каталог.
// Без 1С (нет ни мока, ни ONEC_URL) — пропускаем: ЛК поднимается и без неё.
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  const env = readServerEnv()
  if (!env.onecMock && !(env.onecUrl && (env.onecToken || (env.onecLogin && env.onecPassword)))) return
  setTimeout(() => {
    // Остатки — только поверх каталога: без товаров в индексе они не сохраняются.
    syncCatalog()
      .then(run => (run.status === 'done' ? syncStock().then(() => syncPrices()) : undefined))
      // График и рейсы — из 1С сразу: без графика корзина не назовёт дату доставки.
      // По OData графика и рейсов пока нет (docs/onec-odata.md) — не дёргаем.
      .then(() => (onecUnsupportedFlows().includes('schedule') ? undefined : syncDeliverySchedule()))
      .then(() => (onecUnsupportedFlows().includes('trips') ? undefined : syncTrips()))
      .catch(e => console.error(`[catalog] warmup: ${(e as Error).message}`))
  }, 1000).unref()
})
