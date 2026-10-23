// Первый прогон каталога, остатков и прайса при старте: иначе свежий сервер час показывал бы пустой каталог.
// Без 1С (нет ни мока, ни ONEC_URL) — пропускаем: ЛК поднимается и без неё.
import type { AutoFlow } from '../utils/syncSchedule'

export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  const env = readServerEnv()
  if (!env.onecMock && !(env.onecUrl && (env.onecToken || (env.onecLogin && env.onecPassword)))) return
  // Автосинхронизация на паузе или каталог только вручную — при старте в 1С не идём.
  if (env.syncEvery.catalog <= 0) return
  setTimeout(() => {
    const db = useDb()
    const paused = () => readAutoSyncPaused(db).paused
    if (paused()) return
    // Прогрев — тот же запуск: расписание не должно повторить его в ту же минуту.
    const step = async (flow: AutoFlow, run: () => Promise<unknown>) => {
      if (paused() || env.syncEvery[flow] <= 0) return
      markAutoStart(flow)
      await run()
    }
    ;(async () => {
      markAutoStart('catalog')
      const catalog = await syncCatalog()
      // Остатки — только поверх каталога: без товаров в индексе они не сохраняются.
      if (catalog.status !== 'done') return
      await step('stock', syncStock)
      await step('prices', syncPrices)
      // График и рейсы — из 1С сразу: без графика корзина не назовёт дату доставки.
      if (!onecUnsupportedFlows().includes('schedule')) await step('schedule', syncDeliverySchedule)
      if (!onecUnsupportedFlows().includes('trips')) await step('trips', syncTrips)
    })().catch(e => console.error(`[catalog] warmup: ${(e as Error).message}`))
  }, 1000).unref()
})
