/**
 * Сессия сотрудника клиента: подписанный токен в httpOnly cookie на 30 дней (docs/spec.md §3).
 * Формат — JWT HS256 (заголовок.тело.подпись, base64url), ключ — SESSION_SECRET. Без библиотеки:
 * нам нужна одна схема подписи, а не вся спецификация JWT; чужой `alg` не принимаем вовсе.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'wcp_session'
export const SESSION_TTL_SEC = 30 * 24 * 3600

export interface SessionClaims {
  /** Контакт CRM — сотрудник клиента. */
  contactId: number
  /** Компания CRM — граница данных: всё, что видит сессия, — только этой компании. */
  companyId: number
  /** Элемент «Доступ в ЛК»: по нему сверяется, не отозван ли ключ. */
  accessId: number
  iat: number
  exp: number
}

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url')
}

export function signSession(claims: Omit<SessionClaims, 'iat' | 'exp'>, secret: string, nowSec = Math.floor(Date.now() / 1000)): string {
  if (secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters')
  const body = Buffer.from(JSON.stringify({ ...claims, iat: nowSec, exp: nowSec + SESSION_TTL_SEC })).toString('base64url')
  return `${HEADER}.${body}.${sign(`${HEADER}.${body}`, secret)}`
}

export function verifySession(token: string | undefined, secret: string, nowSec = Math.floor(Date.now() / 1000)): SessionClaims | null {
  if (!token || secret.length < 32) return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== HEADER) return null
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`, secret))
  const actual = Buffer.from(parts[2]!)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as SessionClaims
    const ints = [claims.contactId, claims.companyId, claims.accessId, claims.iat, claims.exp]
    if (!ints.every(v => Number.isInteger(v) && v > 0)) return null
    return claims.exp > nowSec ? claims : null
  }
  catch {
    return null
  }
}
