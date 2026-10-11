import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../server/db/sqlite'
import { hashAccessKey } from '../server/utils/accessKeys'
import { login, MAX_FAILS_PER_IP, MAX_FAILS_PER_LOGIN, pruneJournals, sqliteLoginJournal } from '../server/utils/login'
import type { AccessDirectory, AccessRecord, CompanyInfo } from '../server/services/b24Access'

const KEY = 'AbcdEfghJkmn2345'
const NOW = new Date('2026-10-11T12:00:00Z')
const SECRET = 'k'.repeat(32)
const HASH = await hashAccessKey(KEY)

function directory(records: AccessRecord[], companies: CompanyInfo[], contacts: Record<string, number[]>): AccessDirectory {
  return {
    findContactIds: async l => contacts[l.value] ?? [],
    listAccessByContacts: async ids => records.filter(r => ids.includes(r.contactId)),
    getAccess: async id => records.find(r => r.id === id) ?? null,
    getCompany: async id => companies.find(c => c.id === id) ?? null,
    markLogin: async () => {},
    upsertAccess: async () => 0,
    revokeAccess: async () => 0,
    contactInCompany: async () => true,
  }
}

describe('вход', () => {
  let db: DatabaseSync
  let journal: ReturnType<typeof sqliteLoginJournal>
  const rec = (over: Partial<AccessRecord> = {}): AccessRecord => ({ id: 11, contactId: 5, companyId: 7, keyHash: HASH, status: 'active', expiresAt: null, ...over })
  const company: CompanyInfo = { id: 7, title: 'ООО «Клиент»', onecGuid: '0d16986b-24f9-4029-b2a9-0106aacaaf0d', assignedById: 3 }
  const contacts = { '375291234567': [5] }

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    migrate(db)
    journal = sqliteLoginJournal(db)
  })

  const run = (r: AccessRecord[], k = KEY, l = '+375 29 123-45-67', ip = '1.1.1.1', c = [company]) =>
    login({ login: l, key: k, ip }, { directory: directory(r, c, contacts), journal, secret: SECRET, now: () => NOW })

  it('верный логин и ключ — сессия на компанию из записи доступа', async () => {
    expect(await run([rec()])).toMatchObject({ ok: true, contactId: 5, companyId: 7, accessId: 11 })
  })

  it('лимит по IP: разные логины с одного адреса упираются в MAX_FAILS_PER_IP', async () => {
    for (let i = 0; i < MAX_FAILS_PER_IP; i++) await run([rec()], KEY, `user${i}@x.by`, '9.9.9.9')
    expect(await run([rec()], KEY, '+375291234567', '9.9.9.9')).toMatchObject({ ok: false, reason: 'locked', status: 429 })
    expect(await run([rec()], KEY, '+375291234567', '8.8.8.8')).toMatchObject({ ok: true })
  })

  it('ключ короче 12 или длиннее 128 знаков — invalid_input без scrypt', async () => {
    expect(await run([rec()], 'Abc2345')).toMatchObject({ reason: 'invalid_input' })
    expect(await run([rec()], 'A'.repeat(129))).toMatchObject({ reason: 'invalid_input' })
  })

  it('ровно в момент expiresAt ключ уже истёк', async () => {
    expect(await run([rec({ expiresAt: NOW.toISOString() })])).toMatchObject({ reason: 'expired' })
  })

  it('сбой записи LAST_LOGIN вход не ломает', async () => {
    const dir = { ...directory([rec()], [company], contacts), markLogin: async () => { throw new Error('503') } }
    expect(await login({ login: '+375291234567', key: KEY, ip: '1.1.1.1' }, { directory: dir, journal, secret: SECRET, now: () => NOW }))
      .toMatchObject({ ok: true })
  })

  it('каждый отказ — 401 без подсказки, причина — только в журнале', async () => {
    const cases: [AccessRecord[], string, string, CompanyInfo[], string][] = [
      [[rec()], KEY, '+375 29 000-00-00', [company], 'no_contact'],
      [[], KEY, '+375291234567', [company], 'no_access'],
      [[rec()], 'WrongKey23456789', '+375291234567', [company], 'bad_key'],
      [[rec({ status: 'revoked' })], KEY, '+375291234567', [company], 'revoked'],
      [[rec({ expiresAt: '2026-10-01T00:00:00Z' })], KEY, '+375291234567', [company], 'expired'],
      [[rec()], KEY, '+375291234567', [{ ...company, onecGuid: null }], 'no_guid'],
    ]
    for (const [records, key, l, companies, reason] of cases) {
      const result = await run(records, key, l, `ip-${reason}`, companies)
      expect(result).toEqual({ ok: false, reason, status: 401 })
    }
    expect(db.prepare('SELECT reason FROM login_journal ORDER BY id').all().map(r => (r as { reason: string }).reason))
      .toEqual(['no_contact', 'no_access', 'bad_key', 'revoked', 'expired', 'no_guid'])
  })

  it('журнал хранит хэш логина, а не телефон', async () => {
    await run([rec()], 'WrongKey23456789')
    const row = db.prepare('SELECT login_hash FROM login_journal').get() as { login_hash: string }
    expect(row.login_hash).toMatch(/^[0-9a-f]{32}$/)
    expect(JSON.stringify(db.prepare('SELECT * FROM login_journal').all())).not.toContain('375291234567')
  })

  it(`после ${MAX_FAILS_PER_LOGIN} неудач логин заблокирован — даже верным ключом, и блок не продлевает сам себя`, async () => {
    for (let i = 0; i < MAX_FAILS_PER_LOGIN; i++) await run([rec()], 'WrongKey23456789', '+375291234567', `ip${i}`)
    expect(await run([rec()])).toEqual({ ok: false, reason: 'locked', status: 429 })
    expect(await run([rec()])).toMatchObject({ reason: 'locked' })
    const fails = db.prepare("SELECT COUNT(*) AS n FROM login_journal WHERE ok = 0").get() as { n: number }
    expect(fails.n).toBe(MAX_FAILS_PER_LOGIN)
  })

  it('параллельные попытки упираются в лимит: попытка резервируется до похода в CRM', async () => {
    let verified = 0
    const slow = {
      ...directory([rec()], [company], contacts),
      listAccessByContacts: async () => { await new Promise(r => setTimeout(r, 20)); verified++; return [rec()] },
    }
    const attempts = Array.from({ length: 20 }, (_, i) => login({ login: '+375291234567', key: 'WrongKey2345678' + i, ip: `ip${i}` }, { directory: slow, journal, secret: SECRET, now: () => NOW }))
    const results = await Promise.all(attempts)
    expect(results.filter(r => !r.ok && r.reason === 'locked').length).toBe(20 - MAX_FAILS_PER_LOGIN)
    expect(verified).toBe(MAX_FAILS_PER_LOGIN)
  })

  it('журналы старше 90 дней удаляются', async () => {
    await run([rec()], 'WrongKey23456789')
    expect(pruneJournals(db, new Date(NOW.getTime() + 91 * 86_400_000))).toBe(1)
  })

  it('ключ сверяется со всеми записями контакта — вход в ту компанию, чей ключ', async () => {
    const other = rec({ id: 12, companyId: 8, keyHash: await hashAccessKey('OtherKey23456789') })
    const result = await run([rec(), other], 'OtherKey23456789', '+375291234567', '1.1.1.1', [company, { ...company, id: 8 }])
    expect(result).toMatchObject({ ok: true, companyId: 8, accessId: 12 })
  })

  it('CRM недоступна — 503, не «неверный ключ»', async () => {
    const broken = { ...directory([], [], contacts), findContactIds: async () => { throw new Error('ECONNREFUSED') } }
    const result = await login({ login: '+375291234567', key: KEY, ip: 'x' }, { directory: broken, journal, secret: SECRET, now: () => NOW })
    expect(result).toEqual({ ok: false, reason: 'error', status: 503 })
    // Простой CRM в лимит попыток не идёт: после восстановления честный клиент не заблокирован.
    for (let i = 0; i < MAX_FAILS_PER_LOGIN; i++) await login({ login: '+375291234567', key: KEY, ip: 'x' }, { directory: broken, journal, secret: SECRET, now: () => NOW })
    expect(await run([rec()], KEY, '+375291234567', 'x')).toMatchObject({ ok: true })
  })
})

describe('выдача ключа', () => {
  it('ключ — только контакту этой компании и только компании с GUID 1С', async () => {
    const { issueAccessKey } = await import('../server/utils/accessAdmin')
    const company: CompanyInfo = { id: 7, title: 'x', onecGuid: '0d16986b-24f9-4029-b2a9-0106aacaaf0d', assignedById: null }
    let stored = ''
    const dir = { ...directory([], [company], {}), upsertAccess: async (_c: number, _co: number, hash: string) => { stored = hash; return 33 } }
    expect(await issueAccessKey({ ...dir, contactInCompany: async () => false }, { contactId: 5, companyId: 7 })).toEqual({ ok: false, error: 'contact_not_in_company' })
    expect(await issueAccessKey({ ...dir, getCompany: async () => ({ ...company, onecGuid: null }) }, { contactId: 5, companyId: 7 })).toEqual({ ok: false, error: 'company_without_guid' })

    const ok = await issueAccessKey(dir, { contactId: 5, companyId: 7, ttlDays: 30 }, NOW)
    expect(ok).toMatchObject({ ok: true, accessId: 33, expiresAt: '2026-11-10T12:00:00.000Z' })
    // В CRM уходит хэш, а не сам ключ — и этим хэшем ключ потом проверяется.
    const { verifyAccessKey } = await import('../server/utils/accessKeys')
    expect(stored).not.toContain((ok as { key: string }).key)
    expect(await verifyAccessKey((ok as { key: string }).key, stored)).toBe(true)
  })

  it('срок ключа — целые дни от 1 до MAX_TTL_DAYS', async () => {
    const { issueAccessKey, MAX_TTL_DAYS } = await import('../server/utils/accessAdmin')
    const company: CompanyInfo = { id: 7, title: 'x', onecGuid: '0d16986b-24f9-4029-b2a9-0106aacaaf0d', assignedById: null }
    const dir = { ...directory([], [company], {}), upsertAccess: async () => 33 }
    for (const ttlDays of [0, -1, 1.5, MAX_TTL_DAYS + 1]) {
      expect(await issueAccessKey(dir, { contactId: 5, companyId: 7, ttlDays })).toEqual({ ok: false, error: 'bad_ttl' })
    }
    for (const ttlDays of [1, MAX_TTL_DAYS]) {
      expect(await issueAccessKey(dir, { contactId: 5, companyId: 7, ttlDays })).toMatchObject({ ok: true })
    }
  })
})
