/**
 * Синхронизация потока 1С по курсору `changedSince` с журналом запусков — паттерн очереди со
 * статусами из bx-shef/insync (`SyncTable`, `ESTATUS`), переписанный на TS (docs/related-repos.md).
 *
 * Правила:
 * - курсор — наибольший `changedAt` из полученного, а не «сейчас»: часы 1С и ЛК расходятся, и
 *   «сейчас» сервера ЛК могло бы перепрыгнуть изменения, которые 1С пометила своим временем;
 * - `changedSince` включает границу (контракт): запись того же момента, что курсор, но появившаяся
 *   после запуска, при строгом «>» терялась бы навсегда. Цена — граничные записи приходят повторно,
 *   потребители идемпотентны по GUID;
 * - чтение по ключу, а не по номеру страницы от начала: следующий запрос берёт `changedSince` =
 *   `changedAt` последней полученной строки. Запись, изменённая во время чтения, уезжает в хвост
 *   (её `changedAt` новее) и приходит позже, а не сдвигает непрочитанные строки на уже прочитанную
 *   страницу. Номер страницы растёт только внутри строк с одинаковым `changedAt`;
 * - курсор двигается только после того, как потребитель принял ВСЮ выборку: упал на середине —
 *   следующий запуск возьмёт её снова (потребители идемпотентны по GUID 1С);
 * - каждый запуск пишется в журнал со статусом, отказ не теряется молча.
 *
 * Потребители (запись компаний в Б24, индекс каталога, остатки) появляются на этапах 2–4;
 * здесь — механика, без привязки к ним.
 */
import type { DatabaseSync } from 'node:sqlite'
import type { ListParams } from '../services/onec'
import { OnecError } from '../services/onec'

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
  /** Ключ строки для снятия повторов на границах страниц: GUID или пара GUID (остаток — товар|склад). */
  key(row: T): string
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
    const items = await readByKey(flow, cursorFrom)
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

/**
 * Все строки, изменённые начиная с `cursor` (включительно), чтением по ключу `changedAt`.
 * Повторы на границах страниц снимаются по ключу строки (GUID и момент изменения).
 */
export async function readByKey<T extends { changedAt: string }>(
  flow: Pick<FlowDefinition<T>, 'load' | 'key'>,
  cursor: string | null,
  maxRequests = 10_000,
): Promise<T[]> {
  const out: T[] = []
  const seen = new Set<string>()
  const keyOf = (row: T) => `${flow.key(row)}|${row.changedAt}`
  let since = cursor
  let page = 1
  for (let n = 0; ; n++) {
    if (n >= maxRequests) throw new OnecError('contract', `1C: more than ${maxRequests} requests in one sync`)
    const { items, nextPage } = await flow.load({ page, ...(since ? { changedSince: since } : {}) })
    for (const row of items) {
      const key = keyOf(row)
      if (!seen.has(key)) {
        seen.add(key)
        out.push(row)
      }
    }
    if (nextPage === null || items.length === 0) return out
    const last = items.at(-1)!.changedAt
    // Вся страница — один момент: двигаться по ключу некуда, идём по страницам внутри него.
    if (last === since) page++
    else {
      since = last
      page = 1
    }
  }
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

/** Хранилище курсоров и журнала в SQLite (server/db/sqlite.ts): переживает перезапуск. */
export function sqliteSyncStore(db: import('node:sqlite').DatabaseSync): SyncStore {
  const getCursor = db.prepare('SELECT cursor FROM sync_cursor WHERE flow = ?')
  const setCursor = db.prepare(`INSERT INTO sync_cursor (flow, cursor, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (flow) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`)
  const insertRun = db.prepare(`INSERT INTO sync_run (flow, status, started_at, finished_at, cursor_from, cursor_to, received, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  const updateRun = db.prepare(`UPDATE sync_run SET status = ?, finished_at = ?, cursor_to = ?, received = ?, error = ?
    WHERE flow = ? AND started_at = ?`)
  return {
    async getCursor(flow) {
      return (getCursor.get(flow) as { cursor: string } | undefined)?.cursor ?? null
    },
    async setCursor(flow, cursor) {
      setCursor.run(flow, cursor, new Date().toISOString())
    },
    async saveRun(run) {
      const changed = updateRun.run(run.status, run.finishedAt, run.cursorTo, run.received, run.error, run.flow, run.startedAt).changes
      if (Number(changed) === 0) insertRun.run(run.flow, run.status, run.startedAt, run.finishedAt, run.cursorFrom, run.cursorTo, run.received, run.error)
    },
  }
}

/**
 * Прогоны, которые процесс не дописал (упал или перезапущен посреди обмена): при старте помечаем
 * их «прервано» — иначе в журнале они висят «идёт» навсегда (стенд 2026-10-23).
 */
export function closeInterruptedRuns(db: DatabaseSync, at: string): number {
  return Number(db.prepare(`UPDATE sync_run SET status = 'failed', finished_at = ?, error = 'Прервано: сервер перезапущен во время обмена'
    WHERE status = 'running'`).run(at).changes)
}
