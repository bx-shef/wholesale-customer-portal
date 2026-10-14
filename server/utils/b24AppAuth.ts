/**
 * Локальное приложение коробки — единственный канал сервера ЛК к Битрикс24 (вебхук отменён,
 * решение владельца 14.10.2026). Коробка при установке присылает токены на адрес установки;
 * здесь — их проверка, хранение и продление.
 *
 * Проверка установки — ПРОДЛЕНИЕМ: присланный refresh-токен обменивается на новый нашими
 * client_id/client_secret. Подделать такой токен нельзя без секрета приложения, а ответ сервера
 * авторизации сам называет портал (`member_id`, `client_endpoint`) — сверяем с присланным.
 * Без этого любой, кто знает адрес установки, подсунул бы ЛК токены своего портала.
 */
import type { DatabaseSync } from 'node:sqlite'

export interface AppAuth {
  domain: string
  memberId: string
  accessToken: string
  refreshToken: string
  /** Мс эпохи. */
  expiresAt: number
  /** Сервер авторизации, `https://oauth.bitrix.info/rest/`. */
  serverEndpoint: string
}

export interface AppCreds { clientId: string, clientSecret: string }

export interface InstallPayload {
  domain: string
  memberId: string
  refreshToken: string
  serverEndpoint: string
}

/** Сервер авторизации — только облачный Битрикс24: адрес приходит в запросе, иначе это SSRF. */
const OAUTH_HOSTS = new Set(['oauth.bitrix.info', 'oauth.bitrix24.tech'])
export const DEFAULT_SERVER_ENDPOINT = 'https://oauth.bitrix.info/rest/'

export function safeServerEndpoint(raw: string | undefined): string | null {
  if (!raw) return DEFAULT_SERVER_ENDPOINT
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && OAUTH_HOSTS.has(u.host) && !u.username && !u.password ? `https://${u.host}/rest/` : null
  }
  catch {
    return null
  }
}

/** Поля установки из тела POST коробки (форма) и строки запроса (DOMAIN). */
export function parseInstallPayload(body: Record<string, unknown> | null, query: Record<string, unknown>): InstallPayload | null {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const domain = s(query.DOMAIN).toLowerCase()
  const memberId = s(body?.member_id)
  const refreshToken = s(body?.REFRESH_ID)
  if (!domain || !memberId || !refreshToken || refreshToken.length > 512) return null
  const serverEndpoint = safeServerEndpoint(s(body?.SERVER_ENDPOINT) || undefined)
  if (!serverEndpoint) return null
  return { domain, memberId, refreshToken, serverEndpoint }
}

export type TokenFetch = (url: string) => Promise<{ ok: boolean, json: () => Promise<unknown> }>

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  member_id?: string
  client_endpoint?: string
  server_endpoint?: string
  error?: string
}

/** Обменять refresh-токен на новую пару. Ошибка сервера авторизации — исключение. */
export async function refreshAppToken(creds: AppCreds, serverEndpoint: string, refreshToken: string, fetchFn: TokenFetch, now = Date.now()): Promise<Omit<AppAuth, 'domain'> & { clientHost: string | null }> {
  const base = serverEndpoint.replace(/\/rest\/$/, '')
  const q = new URLSearchParams({ grant_type: 'refresh_token', client_id: creds.clientId, client_secret: creds.clientSecret, refresh_token: refreshToken })
  const res = await fetchFn(`${base}/oauth/token/?${q}`)
  const data = await res.json().catch(() => null) as TokenResponse | null
  if (!res.ok || !data?.access_token || !data.refresh_token || data.error) throw new Error(`oauth refresh failed: ${data?.error ?? 'bad response'}`)
  let clientHost: string | null
  try {
    clientHost = data.client_endpoint ? new URL(data.client_endpoint).host.toLowerCase() : null
  }
  catch {
    clientHost = null
  }
  return {
    memberId: String(data.member_id ?? ''),
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: now + Math.max(60, Number(data.expires_in) || 3600) * 1000,
    serverEndpoint: safeServerEndpoint(data.server_endpoint) ?? serverEndpoint,
    clientHost,
  }
}

export type InstallResult = { ok: true, auth: AppAuth } | { ok: false, reason: string }

/** Принять установку: портал из списка доверенных, токен продлевается нашим секретом и называет тот же портал. */
export async function acceptInstall(p: InstallPayload, deps: { allowedHosts: string[], creds: AppCreds | null, fetch: TokenFetch, now?: number }): Promise<InstallResult> {
  if (!deps.creds) return { ok: false, reason: 'B24_CLIENT_ID / B24_CLIENT_SECRET не заданы' }
  if (!deps.allowedHosts.includes(p.domain)) return { ok: false, reason: `портал ${p.domain} не указан в B24_PORTAL_HOST` }
  let fresh
  try {
    fresh = await refreshAppToken(deps.creds, p.serverEndpoint, p.refreshToken, deps.fetch, deps.now)
  }
  catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
  if (fresh.memberId !== p.memberId) return { ok: false, reason: 'токен выдан другому порталу (member_id)' }
  if (fresh.clientHost && fresh.clientHost !== p.domain) return { ok: false, reason: `токен выдан порталу ${fresh.clientHost}` }
  return { ok: true, auth: { domain: p.domain, memberId: fresh.memberId, accessToken: fresh.accessToken, refreshToken: fresh.refreshToken, expiresAt: fresh.expiresAt, serverEndpoint: fresh.serverEndpoint } }
}

export function loadAppAuth(db: DatabaseSync): AppAuth | null {
  const row = db.prepare('SELECT domain, member_id, access_token, refresh_token, expires_at, server_endpoint FROM b24_app_auth WHERE id = 1').get() as Record<string, string | number> | undefined
  if (!row) return null
  return {
    domain: String(row.domain),
    memberId: String(row.member_id),
    accessToken: String(row.access_token),
    refreshToken: String(row.refresh_token),
    expiresAt: Number(row.expires_at),
    serverEndpoint: String(row.server_endpoint),
  }
}

export function saveAppAuth(db: DatabaseSync, a: AppAuth, now = new Date()): void {
  db.prepare(`INSERT INTO b24_app_auth (id, domain, member_id, access_token, refresh_token, expires_at, server_endpoint, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET domain = excluded.domain, member_id = excluded.member_id, access_token = excluded.access_token,
      refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, server_endpoint = excluded.server_endpoint, updated_at = excluded.updated_at`)
    .run(a.domain, a.memberId, a.accessToken, a.refreshToken, a.expiresAt, a.serverEndpoint, now.toISOString())
}
