// Раз в сутки: журналы входов и синхронизации старше 90 дней удаляются (в них IP и хэши логинов).
export default defineTask({
  meta: { name: 'maintenance:prune', description: 'Очистка журналов старше срока хранения' },
  run() {
    return { result: { deleted: pruneJournals(useDb()) } }
  },
})
