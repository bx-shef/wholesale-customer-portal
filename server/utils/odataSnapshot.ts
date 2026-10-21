/**
 * Снимок 1С по OData в форме списков контракта (docs/onec-odata.md). Курсора `changedSince` у
 * OData нет, поэтому ЛК читает объект целиком и сам отдаёт синхронизации (server/utils/onecSync.ts)
 * страницы «изменённого с момента» — по тем же правилам, что HTTP-сервис 1С (onec-contract.md §1.5).
 *
 * Чистые функции: снимок и прежние версии внедряются, тесты гоняют их без 1С и без базы.
 */
import { PAGE_SIZE_MAX } from '../../shared/onec/schemas'

export interface SnapshotParams {
  changedSince?: string
  page?: number
  pageSize?: number
}

/**
 * Страница снимка по контракту: строки с `changedAt` не раньше `changedSince` (граница включена),
 * по возрастанию `changedAt`, при равенстве — по ключу, чтобы страницы не перемешивались.
 */
export function snapshotPage<T extends { changedAt: string }>(all: readonly T[], key: (row: T) => string, params: SnapshotParams = {}): { items: T[], nextPage: number | null } {
  const page = Math.max(1, params.page ?? 1)
  const size = Math.min(Math.max(1, params.pageSize ?? PAGE_SIZE_MAX), PAGE_SIZE_MAX)
  const since = params.changedSince ? Date.parse(params.changedSince) : null
  const rows = all
    .filter(r => since === null || Date.parse(r.changedAt) >= since)
    .sort((a, b) => Date.parse(a.changedAt) - Date.parse(b.changedAt) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
  const items = rows.slice((page - 1) * size, page * size)
  return { items, nextPage: rows.length > page * size ? page + 1 : null }
}

export interface VersionMark { version: string, changedAt: string }

/**
 * Момент изменения по версии объекта: версия совпала с прежней — прежний момент, иначе `now`.
 * Возвращает строки с проставленным `changedAt` и то, что записать в хранилище версий.
 */
export function stampByVersion<T extends { changedAt: string }>(
  rows: ReadonlyArray<{ key: string, version: string, row: T }>,
  previous: ReadonlyMap<string, VersionMark>,
  now: string,
): { rows: T[], updates: Array<{ key: string } & VersionMark> } {
  const updates: Array<{ key: string } & VersionMark> = []
  const out = rows.map(({ key, version, row }) => {
    const prev = previous.get(key)
    if (prev && prev.version === version) return { ...row, changedAt: prev.changedAt }
    updates.push({ key, version, changedAt: now })
    return { ...row, changedAt: now }
  })
  return { rows: out, updates }
}
