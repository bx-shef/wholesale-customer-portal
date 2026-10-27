/**
 * Вход сотрудника клиента (docs/spec.md §3): логин (телефон/email контакта) + ключ доступа →
 * подписанная сессия. Чистая логика с внедряемыми зависимостями: справочник доступа (CRM),
 * журнал входов (SQLite) и часы.
 *
 * Клиенту всегда один ответ на любой отказ — «неверный логин или ключ»: разные тексты
 * подсказывали бы, какие телефоны есть в CRM. Причина пишется только в журнал.
 * Лимит попыток — по логину и по IP за окно; при превышении ключ даже не сверяется.
 */
import { createHmac } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { normalizeLogin } from '../../shared/access/login'
import { ACCESS_STATUS, type AccessDirectory, type AccessRecord } from '../services/b24Access'
import { burnVerifyTime, keyFingerprint, verifyAccessKey } from './accessKeys'

export const LOGIN_WINDOW_MS = 15 * 60_000
export const MAX_FAILS_PER_LOGIN = 5
export const MAX_FAILS_PER_IP = 30
/** Ключ короче — заведомо не наш; длиннее — не тратим scrypt на мусор. */
const KEY_MIN = 12
const KEY_MAX = 128
/** Сколько записей контакта сверяем ключом: каждая — scrypt, больше — подарок для DoS. */
const MAX_VERIFY = 5
/** Журнал входов хранится 90 дней. */
export const LOGIN_JOURNAL_DAYS = 90

export type LoginReason = 'ok' | 'invalid_input' | 'locked' | 'no_contact' | 'no_access' | 'revoked' | 'expired' | 'bad_key' | 'no_guid' | 'error'

export type LoginResult =
  | { ok: true, contactId: number, companyId: number, accessId: number, kf: string }
  | { ok: false, reason: Exclude<LoginReason, 'ok'>, status: 401 | 429 | 503 }

export interface LoginJournal {
  failuresSince(field: 'login_hash' | 'ip', value: string, sinceIso: string): number
  /**
   * Попытка резервируется ДО похода в CRM и считается неудачей, пока не завершится: иначе сто
   * параллельных запросов прошли бы проверку лимита раньше, чем записалась первая неудача.
   */
  begin(entry: { at: string, loginHash: string, ip: string }): number
  finish(id: number, outcome: { reason: LoginReason, contactId?: number, companyId?: number }): void
}

/**
 * Логин в журнале — HMAC с секретом сервера: по журналу видно, что один логин перебирают, но не
 * чей он; голый sha256 телефона перебирается за секунды.
 */
export function loginHash(login: string, secret: string): string {
  return createHmac('sha256', secret).update(login).digest('hex').slice(0, 32)
}

/** Действует ли запись доступа сейчас — то же правило при входе и при каждой проверке сессии. */
export function accessUsable(record: AccessRecord, now: Date): 'ok' | 'revoked' | 'expired' {
  if (record.status !== ACCESS_STATUS.active) return 'revoked'
  if (record.expiresAt && Date.parse(record.expiresAt) <= now.getTime()) return 'expired'
  return 'ok'
}

export async function login(
  input: { login: unknown, key: unknown, ip: string },
  deps: { directory: AccessDirectory, journal: LoginJournal, secret: string, now?: () => Date },
): Promise<LoginResult> {
  const now = (deps.now ?? (() => new Date()))()
  const normalized = typeof input.login === 'string' ? normalizeLogin(input.login) : null
  const key = typeof input.key === 'string' ? input.key.trim() : ''
  // Мусорный логин в журнал не тащим целиком: длина ограничена, а хэш одинаковый для всего неразборчивого.
  const hash = loginHash(normalized ? `${normalized.kind}:${normalized.value}` : 'invalid', deps.secret)
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS).toISOString()

  if (deps.journal.failuresSince('login_hash', hash, since) >= MAX_FAILS_PER_LOGIN
    || deps.journal.failuresSince('ip', input.ip, since) >= MAX_FAILS_PER_IP) {
    const id = deps.journal.begin({ at: now.toISOString(), loginHash: hash, ip: input.ip })
    deps.journal.finish(id, { reason: 'locked' })
    return { ok: false, reason: 'locked', status: 429 }
  }
  const attempt = deps.journal.begin({ at: now.toISOString(), loginHash: hash, ip: input.ip })
  const fail = (reason: Exclude<LoginReason, 'ok'>, status: 401 | 429 | 503 = 401, ids: { contactId?: number, companyId?: number } = {}): LoginResult => {
    deps.journal.finish(attempt, { reason, ...ids })
    return { ok: false, reason, status }
  }
  if (!normalized || key.length < KEY_MIN || key.length > KEY_MAX) return fail('invalid_input')

  try {
    const contactIds = await deps.directory.findContactIds(normalized)
    const records = contactIds.length > 0 ? await deps.directory.listAccessByContacts(contactIds) : []
    if (records.length === 0) {
      // Холостой scrypt: иначе по времени ответа видно, какие телефоны есть в CRM.
      await burnVerifyTime(key)
      return fail(contactIds.length === 0 ? 'no_contact' : 'no_access')
    }

    // Ключ сверяем с записями контакта: у него может быть доступ в нескольких компаниях.
    let matched: AccessRecord | undefined
    for (const r of records.slice(0, MAX_VERIFY)) {
      if (r.keyHash && await verifyAccessKey(key, r.keyHash)) {
        matched = r
        break
      }
    }
    if (!matched) return fail('bad_key')
    const usable = accessUsable(matched, now)
    if (usable !== 'ok') return fail(usable, 401, matched)

    const company = await deps.directory.getCompany(matched.companyId)
    // Без GUID 1С у компании нет договора и цен — входить некуда (docs/spec.md §3).
    if (!company?.onecGuid) return fail('no_guid', 401, matched)

    await deps.directory.markLogin(matched.id, now).catch(() => {})
    deps.journal.finish(attempt, { reason: 'ok', contactId: matched.contactId, companyId: matched.companyId })
    return { ok: true, contactId: matched.contactId, companyId: matched.companyId, accessId: matched.id, kf: keyFingerprint(matched.keyHash) }
  }
  catch (e) {
    console.error(`[login] directory error: ${(e as Error).message}`)
    return fail('error', 503)
  }
}

/**
 * ok в журнале: 1 — вход, 0 — неудача (идёт в лимит), 2 — не в счёт: «заблокирован» (иначе
 * блокировка продлевала бы сама себя) и сбой CRM (честный клиент не должен платить за простой Б24).
 */
const NOT_COUNTED: LoginReason[] = ['locked', 'error']

export function sqliteLoginJournal(db: DatabaseSync): LoginJournal {
  const count = {
    login_hash: db.prepare('SELECT COUNT(*) AS n FROM login_journal WHERE login_hash = ? AND at >= ? AND ok = 0'),
    ip: db.prepare('SELECT COUNT(*) AS n FROM login_journal WHERE ip = ? AND at >= ? AND ok = 0'),
  }
  const insert = db.prepare('INSERT INTO login_journal (at, login_hash, ip, ok, reason) VALUES (?, ?, ?, 0, ?)')
  const update = db.prepare('UPDATE login_journal SET ok = ?, reason = ?, contact_id = ?, company_id = ? WHERE id = ?')
  return {
    failuresSince(field, value, sinceIso) {
      return Number((count[field].get(value, sinceIso) as { n: number }).n)
    },
    begin(e) {
      return Number(insert.run(e.at, e.loginHash, e.ip, 'pending').lastInsertRowid)
    },
    finish(id, o) {
      const ok = o.reason === 'ok' ? 1 : NOT_COUNTED.includes(o.reason) ? 2 : 0
      update.run(ok, o.reason, o.contactId ?? null, o.companyId ?? null, id)
    },
  }
}

/** Удалить записи журналов старше срока хранения (login_journal, sync_run). */
export function pruneJournals(db: DatabaseSync, now = new Date(), days = LOGIN_JOURNAL_DAYS): number {
  const before = new Date(now.getTime() - days * 86_400_000).toISOString()
  const a = db.prepare('DELETE FROM login_journal WHERE at < ?').run(before).changes
  const b = db.prepare('DELETE FROM sync_run WHERE started_at < ?').run(before).changes
  return Number(a) + Number(b)
}
