/**
 * Поток «клиенты 1С → компании Б24» с курсором в SQLite. Один вход и для расписания
 * (server/tasks/sync/companies.ts), и для ручного запуска из /mcp/admin.
 */
import type { ClientT } from '../../shared/onec/schemas'
import { createCompanySync, type UpsertSummary } from '../services/b24Companies'
import { runFlow, sqliteSyncStore, type SyncRun } from './onecSync'

let running: Promise<SyncRun & { summary?: UpsertSummary }> | undefined

export function syncCompanies(): Promise<SyncRun & { summary?: UpsertSummary }> {
  // Одновременно — один запуск: расписание и ручной вызов не должны писать в CRM вдвоём.
  running ??= (async () => {
    const onec = useOnec()
    const sync = createCompanySync(useB24Call())
    let summary: UpsertSummary | undefined
    const run = await runFlow<ClientT>({
      name: 'clients',
      key: c => c.guid,
      load: p => onec.clients(p),
      consume: async (items) => {
        // Договор и адреса доставки — в базу ЛК для корзины и заявок (до CRM: сбой Б24 их не теряет).
        createClientStore(useDb()).save(items)
        summary = await sync.upsert(items)
      },
    }, sqliteSyncStore(useDb()))
    if (run.status === 'failed') console.error(`[sync:clients] ${run.error}`)
    return { ...run, summary }
  })().finally(() => {
    running = undefined
  })
  return running
}
