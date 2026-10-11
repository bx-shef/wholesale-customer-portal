/**
 * Синхронизация потока 1С по курсору `changedSince` с журналом запусков — паттерн очереди со
 * статусами из bx-shef/insync (`SyncTable`, `ESTATUS`), переписанный на TS (docs/related-repos.md).
 *
 * Правила:
 * - курсор — наибольший `changedAt` из полученного, а не «сейчас»: часы 1С и ЛК расходятся, и
 *   «сейчас» сервера ЛК могло бы перепрыгнуть изменения, которые 1С пометила своим временем;
 * - курсор двигается только после того, как потребитель принял ВСЮ выборку: упал на середине —
 *   следующий запуск возьмёт её снова (потребители идемпотентны по GUID 1С);
 * - каждый запуск пишется в журнал со статусом, отказ не теряется молча.
 *
 * Потребители (запись компаний в Б24, индекс каталога, остатки) появляются на этапах 2–4;
 * здесь — механика, без привязки к ним.
 */
import type { ListParams } from '../services/onec'
import { collectPages } from '../services/onec'

export type SyncStatus = 'running' | 'done' | 'failed'

export interface SyncRun {
  flow: string
  status: SyncStatus
  startedAt: string
  finishedAt: string | null
  cursorFrom: string | null
  cursorTo: string | null
  received: number
  error: string | null
}

export interface SyncStore {
  getCursor(flow: string): Promise<string | null>
  setCursor(flow: string, cursor: string): Promise<void>
  saveRun(run: SyncRun): Promise<void>
}

export interface FlowDefinition<T extends { changedAt: string }> {
  name: string
  load(params: ListParams): Promise<{ items: T[], nextPage: number | null }>
  /** Принять выборку целиком; бросает — курсор не двигается. */
  consume(items: T[]): Promise<void>
}

export async function runFlow<T extends { changedAt: string }>(
  flow: FlowDefinition<T>,
  store: SyncStore,
  now: () => Date = () => new Date(),
): Promise<SyncRun> {
  const cursorFrom = await store.getCursor(flow.name)
  const run: SyncRun = {
    flow: flow.name, status: 'running', startedAt: now().toISOString(), finishedAt: null,
    cursorFrom, cursorTo: cursorFrom, received: 0, error: null,
  }
  await store.saveRun(run)
  try {
    const items = await collectPages(page => flow.load({ page, ...(cursorFrom ? { changedSince: cursorFrom } : {}) }))
    run.received = items.length
    await flow.consume(items)
    const newest = items.reduce<string | null>((max, i) => (max === null || Date.parse(i.changedAt) > Date.parse(max) ? i.changedAt : max), cursorFrom)
    if (newest && newest !== cursorFrom) await store.setCursor(flow.name, newest)
    run.cursorTo = newest
    run.status = 'done'
  }
  catch (e) {
    run.status = 'failed'
    // Только класс и сообщение ошибки клиента 1С: значения из ответа туда не попадают (server/services/onec.ts).
    run.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  }
  run.finishedAt = now().toISOString()
  await store.saveRun(run)
  return run
}

/** Хранилище курсоров и журнала в памяти — для тестов и как образец формы. */
export function memorySyncStore(): SyncStore & { runs: SyncRun[], cursors: Map<string, string> } {
  const cursors = new Map<string, string>()
  const runs: SyncRun[] = []
  return {
    cursors,
    runs,
    async getCursor(flow) { return cursors.get(flow) ?? null },
    async setCursor(flow, cursor) { cursors.set(flow, cursor) },
    async saveRun(run) {
      const i = runs.findIndex(r => r.flow === run.flow && r.startedAt === run.startedAt)
      if (i >= 0) runs[i] = { ...run }
      else runs.push({ ...run })
    },
  }
}
