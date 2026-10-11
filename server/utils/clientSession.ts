import type { H3Event } from 'h3'
import { keyFingerprint } from './accessKeys'
import { accessUsable } from './login'
import { SESSION_COOKIE, verifySession, type SessionClaims } from './session'

/** Сессия сотрудника клиента: кто вошёл и от какой компании (docs/spec.md, «Вход»). */
export interface ClientSession {
  contactId: number
  companyId: number
  accessId: number
}

/** Сколько верим проверке ключа: отзыв менеджером вступает в силу не позже чем через это время. */
export const ACCESS_RECHECK_MS = 2 * 60_000
/**
 * Льгота при недоступной CRM: сессию, проверенную успешно не дольше этого назад, не рвём из-за
 * простоя Б24. Дольше — fail-closed: отозванный ключ не должен жить весь простой.
 */
export const CRM_OUTAGE_GRACE_MS = 15 * 60_000
/** Кэш на процесс: при нескольких репликах отзыв через одну из них действует на остальных ≤ ACCESS_RECHECK_MS. */
const checked = new Map<string, { until: number, ok: boolean, lastOk: number }>()

/**
 * Сессия из cookie (браузер) или `Authorization: Bearer` (MCP-клиент с тем же токеном).
 * Подпись проверяется всегда, а статус ключа в CRM — не реже раза в ACCESS_RECHECK_MS: отозванный
 * ключ закрывает уже открытые сессии, а не только новые входы.
 */
export async function resolveClientSession(event: H3Event): Promise<ClientSession | null> {
  const env = readServerEnv()
  const token = getCookie(event, SESSION_COOKIE) ?? parseBearer(getRequestHeader(event, 'authorization')) ?? undefined
  const claims = verifySession(token, env.sessionSecret)
  if (!claims) return null
  return (await accessStillValid(claims)) ? { contactId: claims.contactId, companyId: claims.companyId, accessId: claims.accessId } : null
}

export async function accessStillValid(
  claims: SessionClaims,
  getAccess: (id: number) => Promise<import('../services/b24Access').AccessRecord | null> = id => useAccessDirectory().getAccess(id),
  now = Date.now(),
): Promise<boolean> {
  // Ключ кэша — запись и отпечаток ключа: сессия старого ключа не наследует «ок» новой.
  const cacheKey = `${claims.accessId}:${claims.kf}`
  const cached = checked.get(cacheKey)
  if (cached && cached.until > now) return cached.ok
  try {
    const record = await getAccess(claims.accessId)
    const ok = !!record
      && record.contactId === claims.contactId
      && record.companyId === claims.companyId
      // Перевыпуск ключа меняет хэш — сессии прежнего ключа закрываются.
      && keyFingerprint(record.keyHash) === claims.kf
      && accessUsable(record, new Date(now)) === 'ok'
    checked.set(cacheKey, { until: now + ACCESS_RECHECK_MS, ok, lastOk: ok ? now : 0 })
    return ok
  }
  catch (e) {
    // CRM недоступна: отказ не кэшируем; недавно проверенной сессии даём льготу, остальным — нет.
    console.error(`[session] access recheck failed: ${(e as Error).message}`)
    return !!cached?.ok && now - cached.lastOk < CRM_OUTAGE_GRACE_MS
  }
}

/** Отзыв и перевыпуск из ЛК (/mcp/admin) — сбросить кэш, чтобы изменение действовало сразу. */
export function forgetAccessCheck(accessId?: number) {
  if (accessId === undefined) checked.clear()
  else for (const key of checked.keys()) if (key.startsWith(`${accessId}:`)) checked.delete(key)
}
