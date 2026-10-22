/**
 * Данные одного клиента из 1С по его GUID (решение владельца 2026-10-22): соглашение, вид цен,
 * валюта, адреса доставки, зона, запрет отгрузки. Грузятся при входе (кэш старше `ttlMs`) и по
 * расписанию, лежат в SQLite (`onec_client`). 1С недоступна — работаем по кэшу и честно пишем, на
 * какой момент данные; кэша нет — ошибка, которую видит клиент и оператор.
 *
 * GUID приходит только из CRM по компании сессии — чужого клиента так не загрузить.
 */
import type { ClientT } from '../../shared/onec/schemas'
import type { ClientStore, StoredClient } from './clients'

export type ClientLoadStatus =
  /** Кэш свежий, в 1С не ходили. */
  | 'fresh'
  /** Только что загружено из 1С. */
  | 'loaded'
  /** 1С не ответила, отдаём кэш (`loadedAt` — на какой момент). */
  | 'stale'
  /** В 1С такого клиента нет (или он не клиент). */
  | 'missing'
  /** 1С не ответила, кэша нет. */
  | 'error'

export interface ClientLoad {
  status: ClientLoadStatus
  client: StoredClient | null
  loadedAt: string | null
}

export interface ClientLoaderDeps {
  store: Pick<ClientStore, 'get' | 'save' | 'seen'>
  load: (guid: string) => Promise<ClientT | null>
  ttlMs: number
  now?: () => Date
  /** Сбой загрузки: `cached` — был ли кэш (без кэша — повод для оповещения). */
  onFail?: (guid: string, error: Error, cached: boolean) => void
}

export function createClientLoader(deps: ClientLoaderDeps) {
  const now = deps.now ?? (() => new Date())
  // Один GUID — одна загрузка за раз: экран и расписание не идут в 1С вдвоём.
  const inflight = new Map<string, Promise<ClientLoad>>()

  async function run(guid: string, force: boolean): Promise<ClientLoad> {
    const cached = deps.store.get(guid)
    const at = now()
    const fresh = cached?.loadedAt && at.getTime() - Date.parse(cached.loadedAt) < deps.ttlMs
    if (cached && fresh && !force) return { status: 'fresh', client: cached, loadedAt: cached.loadedAt }
    try {
      const client = await deps.load(guid)
      if (!client) return { status: 'missing', client: null, loadedAt: null }
      const iso = at.toISOString()
      deps.store.save([client], iso)
      return { status: 'loaded', client: deps.store.get(guid), loadedAt: iso }
    }
    catch (e) {
      deps.onFail?.(guid, e as Error, Boolean(cached?.loadedAt))
      return cached?.loadedAt ? { status: 'stale', client: cached, loadedAt: cached.loadedAt } : { status: 'error', client: null, loadedAt: null }
    }
  }

  return {
    /** Данные клиента: из кэша, если он свежее `ttlMs` (и не `force`), иначе из 1С. Отмечает визит. */
    async ensure(guid: string, opts: { force?: boolean, seen?: boolean } = {}): Promise<ClientLoad> {
      const key = guid.toLowerCase()
      let p = inflight.get(key)
      if (!p) {
        p = run(key, opts.force === true).finally(() => inflight.delete(key))
        inflight.set(key, p)
      }
      const result = await p
      if (opts.seen !== false && result.client) deps.store.seen(key, now().toISOString())
      return result
    },
  }
}

export type ClientLoader = ReturnType<typeof createClientLoader>
