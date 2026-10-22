// Расписание: данные клиентов, заходивших в ЛК за 30 дней, — заново из 1С, если старше срока
// свежести (`ONEC_CLIENT_TTL_MIN`). Остальных не трогаем: в 1С тысячи «клиентов», ЛК нужны живые.
import { refreshSeenClients } from '../../utils/clientRefresh'

export default defineTask({
  meta: { name: 'sync:clients', description: 'Данные клиентов ЛК из 1С по GUID' },
  async run() {
    const r = await refreshSeenClients({ loader: useClientLoader(), store: useClientStore(), runs: sqliteSyncStore(useDb()), ttlMs: readServerEnv().onecClientTtlMin * 60_000 })
    return { result: JSON.stringify(r) }
  },
})
