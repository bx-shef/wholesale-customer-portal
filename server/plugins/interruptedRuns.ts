// При старте закрываем прогоны обмена, которые прервал перезапуск: в журнале они иначе висят «идёт».
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  const closed = closeInterruptedRuns(useDb(), new Date().toISOString())
  if (closed) console.warn(`[sync] ${closed} interrupted run(s) marked failed`)
})
