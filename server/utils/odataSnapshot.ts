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

/** Снимок, отсортированный один раз: по моменту изменения, при равенстве — по ключу. */
export interface SortedSnapshot<T> { rows: T[], times: number[] }

export function sortSnapshot<T extends { changedAt: string }>(all: readonly T[], key: (row: T) => string): SortedSnapshot<T> {
  // Момент и ключ считаем один раз: страниц за прогон сотни, сортировать каждую — квадрат.
  const tagged = all.map(row => ({ row, t: Date.parse(row.changedAt), k: key(row) }))
  tagged.sort((a, b) => a.t - b.t || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
  return { rows: tagged.map(x => x.row), times: tagged.map(x => x.t) }
}

/**
 * Страница отсортированного снимка по контракту (§1.5): строки с `changedAt` не раньше
 * `changedSince` (граница включена), по `pageSize` (не больше `PAGE_SIZE_MAX`).
 */
export function pageOfSorted<T>(snap: SortedSnapshot<T>, params: SnapshotParams = {}): { items: T[], nextPage: number | null } {
  const page = Math.max(1, params.page ?? 1)
  const size = Math.min(Math.max(1, params.pageSize ?? PAGE_SIZE_MAX), PAGE_SIZE_MAX)
  let from = 0
  if (params.changedSince) {
    // Первая строка не раньше границы — двоичным поиском по отсортированным моментам.
    const since = Date.parse(params.changedSince)
    let lo = 0
    let hi = snap.times.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (snap.times[mid]! < since) lo = mid + 1
      else hi = mid
    }
    from = lo
  }
  const start = from + (page - 1) * size
  const items = snap.rows.slice(start, start + size)
  return { items, nextPage: snap.rows.length > start + size ? page + 1 : null }
}

/** То же для неотсортированного списка — для тестов и разовых вызовов. */
export function snapshotPage<T extends { changedAt: string }>(all: readonly T[], key: (row: T) => string, params: SnapshotParams = {}): { items: T[], nextPage: number | null } {
  return pageOfSorted(sortSnapshot(all, key), params)
}

export interface VersionMark { version: string, changedAt: string }

/**
 * Момент изменения по версии объекта: версия совпала с прежней — прежний момент, иначе `now`;
 * пустая версия — всегда `now` и в хранилище не пишется.
 * Возвращает строки с проставленным `changedAt` и то, что записать в хранилище версий.
 */
export function stampByVersion<T extends { changedAt: string }>(
  rows: ReadonlyArray<{ key: string, version: string, row: T }>,
  previous: ReadonlyMap<string, VersionMark>,
  now: string,
): { rows: T[], updates: Array<{ key: string } & VersionMark> } {
  const updates: Array<{ key: string } & VersionMark> = []
  const out = rows.map(({ key, version, row }) => {
    // Версии нет — сравнивать нечем: строка считается изменённой на каждом прогоне.
    if (!version) return { ...row, changedAt: now }
    const prev = previous.get(key)
    if (prev && prev.version === version) return { ...row, changedAt: prev.changedAt }
    updates.push({ key, version, changedAt: now })
    return { ...row, changedAt: now }
  })
  return { rows: out, updates }
}

/**
 * Убирать ли остатки, которых нет в снимке (OData, catalogSync): только после удачного прогона
 * снимком, только если снимок не пуст и не меньше половины того, что уже лежит в ЛК. Пустой или
 * резко усохший снимок больше похож на сбой 1С или фильтра складов, чем на опустевший склад —
 * вчерашние остатки лучше, чем витрина, где вдруг ничего нет.
 */
export function shouldPruneStock(o: { snapshot: boolean, status: string, received: number, cursorTo: string | null, storedRows: number }): boolean {
  return o.snapshot && o.status === 'done' && o.received > 0 && !!o.cursorTo && o.received * 2 >= o.storedRows
}
