/**
 * Вход сотрудника клиента (docs/spec.md §3): логин (телефон/email контакта) + ключ доступа →
 * подписанная сессия. Чистая логика с внедряемыми зависимостями: справочник доступа (CRM),
 * журнал входов (SQLite) и часы.
 *
 * Клиенту всегда один ответ на любой отказ — «неверный логин или ключ»: разные тексты
 * подсказывали бы, какие телефоны есть в CRM. Причина пишется только в журнал.
 * Лимит попыток — по логину и по IP за окно; при превышении ключ даже не сверяется.
 */
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { normalizeLogin } from '../../shared/access/login'
import { ACCESS_STATUS, type AccessDirectory, type AccessRecord } from '../services/b24Access'
import { verifyAccessKey } from './accessKeys'

export const LOGIN_WINDOW_MS = 15 * 60_000
export const MAX_FAILS_PER_LOGIN = 5
export const MAX_FAILS_PER_IP = 30
/** Ключ короче — заведомо не наш; длиннее — не тратим scrypt на мусор. */
const KEY_MIN = 12
const KEY_MAX = 128

export type LoginReason = 'ok' | 'invalid_input' | 'locked' | 'no_contact' | 'no_access' | 'revoked' | 'expired' | 'bad_key' | 'no_guid' | 'error'

export type LoginResult =
  | { ok: true, contactId: number, companyId: number, accessId: number }
  | { ok: false, reason: Exclude<LoginReason, 'ok'>, status: 401 | 429 | 503 }

export interface LoginJournal {
  failuresSince(field: 'login_hash' | 'ip', value: string, sinceIso: string): number
  record(entry: { at: string, loginHash: string, ip: string, ok: boolean, reason: LoginReason, contactId?: number, companyId?: number }): void
}

/** Логин в журнале — хэшем: по журналу видно, что один логин перебирают, но не чей он. */
export function loginHash(login: string): string {
  return createHash('sha256').update(login).digest('hex').slice(0, 32)
}

/** Действует ли запись доступа сейчас — то же правило при входе и при каждой проверке сессии. */
export function accessUsable(record: AccessRecord, now: Date): 'ok' | 'revoked' | 'expired' {
  if (record.status !== ACCESS_STATUS.active) return 'revoked'
  if (record.expiresAt && Date.parse(record.expiresAt) <= now.getTime()) return 'expired'
  return 'ok'
}

export async function login(
  input: { login: unknown, key: unknown, ip: string },
  deps: { directory: AccessDirectory, journal: LoginJournal, now?: () => Date },
): Promise<LoginResult> {
  const now = (deps.now ?? (() => new Date()))()
  const normalized = typeof input.login === 'string' ? normalizeLogin(input.login) : null
  const key = typeof input.key === 'string' ? input.key.trim() : ''
  const hash = loginHash(normalized ? `${normalized.kind}:${normalized.value}` : String(input.login ?? ''))
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS).toISOString()
  const fail = (reason: Exclude<LoginReason, 'ok'>, status: 401 | 429 | 503 = 401, ids: { contactId?: number, companyId?: number } = {}): LoginResult => {
    deps.journal.record({ at: now.toISOString(), loginHash: hash, ip: input.ip, ok: false, reason, ...ids })
    return { ok: false, reason, status }
  }

  if (deps.journal.failuresSince('login_hash', hash, since) >= MAX_FAILS_PER_LOGIN
    || deps.journal.failuresSince('ip', input.ip, since) >= MAX_FAILS_PER_IP) {
    return fail('locked', 429)
  }
  if (!normalized || key.length < KEY_MIN || key.length > KEY_MAX) return fail('invalid_input')

  try {
    const contactIds = await deps.directory.findContactIds(normalized)
    if (contactIds.length === 0) return fail('no_contact')
    const records = await deps.directory.listAccessByContacts(contactIds)
    if (records.length === 0) return fail('no_access')

    // Ключ сверяем со всеми записями контакта: у него может быть доступ в нескольких компаниях.
    const matched = records.find(r => r.keyHash && verifyAccessKey(key, r.keyHash))
    if (!matched) return fail('bad_key')
    const usable = accessUsable(matched, now)
    if (usable !== 'ok') return fail(usable, 401, matched)

    const company = await deps.directory.getCompany(matched.companyId)
    // Без GUID 1С у компании нет договора и цен — входить некуда (docs/spec.md §3).
    if (!company?.onecGuid) return fail('no_guid', 401, matched)

    await deps.directory.markLogin(matched.id, now).catch(() => {})
    deps.journal.record({ at: now.toISOString(), loginHash: hash, ip: input.ip, ok: true, reason: 'ok', contactId: matched.contactId, companyId: matched.companyId })
    return { ok: true, contactId: matched.contactId, companyId: matched.companyId, accessId: matched.id }
  }
  catch (e) {
    console.error(`[login] directory error: ${(e as Error).message}`)
    return fail('error', 503)
  }
}

export function sqliteLoginJournal(db: DatabaseSync): LoginJournal {
  const count = {
    login_hash: db.prepare('SELECT COUNT(*) AS n FROM login_journal WHERE login_hash = ? AND at >= ? AND ok = 0'),
    ip: db.prepare('SELECT COUNT(*) AS n FROM login_journal WHERE ip = ? AND at >= ? AND ok = 0'),
  }
  const insert = db.prepare('INSERT INTO login_journal (at, login_hash, ip, ok, reason, contact_id, company_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
  return {
    failuresSince(field, value, sinceIso) {
      return Number((count[field].get(value, sinceIso) as { n: number }).n)
    },
    record(e) {
      // «Заблокирован» в счёт неудач не идёт — иначе блокировка продлевала бы сама себя бесконечно.
      insert.run(e.at, e.loginHash, e.ip, e.ok ? 1 : (e.reason === 'locked' ? 2 : 0), e.reason, e.contactId ?? null, e.companyId ?? null)
    },
  }
}
