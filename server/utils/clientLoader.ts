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
  /** Сбой загрузки: `cached` — был ли кэш; `scheduled` — из расписания (там журнал пишет само расписание). */
  onFail?: (guid: string, error: Error, cached: boolean, scheduled: boolean) => void
}

/** «Повторить» чаще этого — отдаём только что загруженное: кнопка не должна бить по 1С. */
export const FORCE_MIN_MS = 30_000
/** Клиента нет в 1С или 1С не ответила без кэша — столько не спрашиваем снова: перезагрузка страницы не идёт в 1С. */
export const NEGATIVE_TTL_MS = 2 * 60_000

export function createClientLoader(deps: ClientLoaderDeps) {
  const now = deps.now ?? (() => new Date())
  // Один GUID — одна загрузка за раз: экран и расписание не идут в 1С вдвоём.
  const inflight = new Map<string, Promise<ClientLoad>>()
  const negative = new Map<string, { until: number, result: ClientLoad }>()

  async function run(guid: string, force: boolean, scheduled: boolean): Promise<ClientLoad> {
    const cached = deps.store.get(guid)
    const at = now()
    const age = cached?.loadedAt ? at.getTime() - Date.parse(cached.loadedAt) : Infinity
    if (cached && age < (force ? FORCE_MIN_MS : deps.ttlMs)) return { status: 'fresh', client: cached, loadedAt: cached.loadedAt }
    const neg = negative.get(guid)
    if (neg && neg.until > at.getTime() && !scheduled) return neg.result
    try {
      const client = await deps.load(guid)
      if (!client) {
        const result: ClientLoad = { status: 'missing', client: null, loadedAt: null }
        negative.set(guid, { until: at.getTime() + NEGATIVE_TTL_MS, result })
        return result
      }
      negative.delete(guid)
      const iso = at.toISOString()
      deps.store.save([client], iso)
      return { status: 'loaded', client: deps.store.get(guid), loadedAt: iso }
    }
    catch (e) {
      deps.onFail?.(guid, e as Error, Boolean(cached?.loadedAt), scheduled)
      if (cached?.loadedAt) return { status: 'stale', client: cached, loadedAt: cached.loadedAt }
      const result: ClientLoad = { status: 'error', client: null, loadedAt: null }
      negative.set(guid, { until: at.getTime() + NEGATIVE_TTL_MS, result })
      return result
    }
  }

  return {
    /** Данные клиента: из кэша, если он свежее `ttlMs` (и не `force`), иначе из 1С. Отмечает визит. */
    async ensure(guid: string, opts: { force?: boolean, seen?: boolean, scheduled?: boolean } = {}): Promise<ClientLoad> {
      const key = guid.toLowerCase()
      const force = opts.force === true
      // «Повторить» не прилипает к идущей обычной загрузке: у него свой запрос.
      const slot = `${key}:${force}`
      let p = inflight.get(slot)
      if (!p) {
        p = run(key, force, opts.scheduled === true).finally(() => inflight.delete(slot))
        inflight.set(slot, p)
      }
      const result = await p
      if (opts.seen !== false && result.client) deps.store.seen(key, now().toISOString())
      return result
    },
  }
}

export type ClientLoader = ReturnType<typeof createClientLoader>
