/**
 * Обновление данных клиентов по расписанию: только заходивших в ЛК за `SEEN_DAYS` дней и только
 * тех, чьи данные старше срока свежести. Запуск пишется в журнал потока «клиенты»: сбой виден на
 * «Состоянии системы» и уходит в Telegram тем же путём, что и сбои остальных потоков. Сбой без кэша при входе клиента пишется туда же —
 * не чаще раза в `FAILURE_RECORD_MS` (orderApi), чтобы 1С в простое не засыпала журнал.
 */
import type { ClientLoader } from './clientLoader'
import type { ClientStore } from './clients'
import type { SyncStore } from './onecSync'

/** Свой поток в журнале: не смешивается со списком клиентов (`clients`), пока тот жив. */
export const CLIENT_DATA_FLOW = 'client_data'
export const SEEN_DAYS = 30
/** За один запуск — не больше: 1С бережём, остальные подтянутся следующим запуском. */
export const REFRESH_BATCH = 50

export async function refreshSeenClients(deps: { loader: ClientLoader, store: Pick<ClientStore, 'due'>, runs: SyncStore, ttlMs: number, now?: () => Date }) {
  const now = deps.now?.() ?? new Date()
  const startedAt = now.toISOString()
  const guids = deps.store.due(new Date(now.getTime() - SEEN_DAYS * 86_400_000).toISOString(), new Date(now.getTime() - deps.ttlMs).toISOString(), REFRESH_BATCH)
  let loaded = 0
  let failed = 0
  for (const g of guids) {
    const r = await deps.loader.ensure(g, { force: true, seen: false, scheduled: true })
    if (r.status === 'loaded') loaded++
    else if (r.status === 'stale' || r.status === 'error') failed++
  }
  const status = failed && !loaded ? 'failed' as const : 'done' as const
  await deps.runs.saveRun({ flow: CLIENT_DATA_FLOW, status, startedAt, finishedAt: new Date().toISOString(), cursorFrom: null, cursorTo: null, received: loaded, error: failed ? `${failed} of ${guids.length} clients not loaded` : null })
  return { due: guids.length, loaded, failed }
}
