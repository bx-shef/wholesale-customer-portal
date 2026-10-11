import type { H3Event } from 'h3'
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
const checked = new Map<number, { until: number, ok: boolean }>()

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

async function accessStillValid(claims: SessionClaims): Promise<boolean> {
  const now = Date.now()
  const cached = checked.get(claims.accessId)
  if (cached && cached.until > now) return cached.ok
  let ok = false
  try {
    const record = await useAccessDirectory().getAccess(claims.accessId)
    ok = !!record && record.contactId === claims.contactId && record.companyId === claims.companyId && accessUsable(record, new Date(now)) === 'ok'
  }
  catch (e) {
    // CRM недоступна: прежний положительный ответ продлеваем, нового доверия не выдаём.
    console.error(`[session] access recheck failed: ${(e as Error).message}`)
    if (cached?.ok) return true
  }
  checked.set(claims.accessId, { until: now + ACCESS_RECHECK_MS, ok })
  return ok
}

/** Отзыв из ЛК (/mcp/admin) — сбросить кэш, чтобы ключ закрылся сразу, а не через 2 минуты. */
export function forgetAccessCheck(accessId?: number) {
  if (accessId === undefined) checked.clear()
  else checked.delete(accessId)
}
