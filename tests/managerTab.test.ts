import { describe, expect, it, vi } from 'vitest'
import type { AccessDirectory, AccessRecord } from '../server/services/b24Access'
import { listCompanyContacts } from '../server/services/b24Access'
import { accessState, allowedHosts, normalizeHost, runTabAction, type TabDeps, type TabRequest } from '../server/utils/managerTab'

const NOW = new Date('2026-10-14T10:00:00Z')
const HOST = 'b24.algena.by'

function fakeDir(records: AccessRecord[] = [], opts: { inCompany?: boolean, guid?: string | null } = {}) {
  const dir: AccessDirectory = {
    findContactIds: async () => [],
    listAccessByContacts: async ids => records.filter(r => ids.includes(r.contactId)),
    getAccess: async () => null,
    getCompany: async id => ({ id, title: 'ООО', onecGuid: opts.guid === undefined ? 'g-1' : opts.guid, assignedById: null }),
    markLogin: async () => {},
    upsertAccess: vi.fn(async () => 77),
    revokeAccess: vi.fn(async () => 1),
    contactInCompany: async () => opts.inCompany ?? true,
  }
  return dir
}

function deps(over: Partial<TabDeps> = {}): TabDeps & { userCall: ReturnType<typeof vi.fn>, forgetAccess: ReturnType<typeof vi.fn> } {
  return {
    allowedHosts: [HOST],
    userCall: portal({}),
    dir: fakeDir(),
    listCompanyContacts: async () => [{ id: 5, name: 'Иванов', phones: ['+375291112233'], emails: [] }],
    forgetAccess: vi.fn(),
    ...over,
  } as never
}

/** Портал глазами сотрудника 7: компания с ответственным `assigned`, админ ли он — `admin`. */
function portal({ assigned = 7, admin = false, me = 7 }: { assigned?: number, admin?: boolean, me?: number }) {
  return vi.fn(async (_h: string, _a: string, method: string, p: Record<string, unknown>) => {
    if (method === 'crm.company.get') return { ID: String(p.id), ASSIGNED_BY_ID: String(assigned) }
    if (method === 'user.current') return { ID: String(me) }
    if (method === 'user.admin') return admin
    throw new Error(`unexpected ${method}`)
  })
}

const req = (over: Partial<TabRequest> = {}): TabRequest => ({ domain: HOST, authId: 'tok', companyId: 10, action: 'list', ...over })
const rec = (over: Partial<AccessRecord> = {}): AccessRecord => ({ id: 1, contactId: 5, companyId: 10, keyHash: 'h', status: 'active', expiresAt: null, ...over })

describe('вкладка компании: кто менеджер', () => {
  it('токен чужого портала — 403, портал даже не спрашиваем', async () => {
    const d = deps()
    const r = await runTabAction(req({ domain: 'evil.bitrix24.by' }), d, NOW)
    expect(r.status).toBe(403)
    expect(d.userCall).not.toHaveBeenCalled()
  })

  it('права проверяет портал: отказ, сбой и чужая компания в ответе — 403', async () => {
    for (const userCall of [
      vi.fn(async () => { throw new Error('ACCESS_DENIED') }),
      vi.fn(async () => null),
      vi.fn(async () => ({ ID: '11', ASSIGNED_BY_ID: '7' })),
    ]) {
      const d = deps({ userCall })
      expect((await runTabAction(req({ action: 'issue', contactId: 5 }), d, NOW)).status).toBe(403)
      expect(d.dir.upsertAccess).not.toHaveBeenCalled()
    }
  })

  it('видеть компанию мало: нужен ответственный или администратор', async () => {
    const stranger = deps({ userCall: portal({ assigned: 8 }) })
    expect((await runTabAction(req({ action: 'issue', contactId: 5 }), stranger, NOW)).status).toBe(403)
    expect(stranger.dir.upsertAccess).not.toHaveBeenCalled()
    expect((await runTabAction(req({ action: 'issue', contactId: 5 }), deps({ userCall: portal({ assigned: 8, admin: true }) }), NOW)).status).toBe(200)
    expect((await runTabAction(req(), deps({ userCall: portal({ me: 0 }) }), NOW)).status).toBe(403)
  })

  it('контакты читаются токеном сотрудника, а не вебхуком', async () => {
    const d = deps({ listCompanyContacts: vi.fn(async (_id, call) => {
      await call('user.current', {})
      return []
    }) })
    await runTabAction(req(), d, NOW)
    expect(d.userCall).toHaveBeenCalledWith(HOST, 'tok', 'user.current', {})
    expect(d.userCall.mock.calls.filter(c => c[2] === 'user.current')).toHaveLength(2)
  })

  it('спрашивает портал про ту компанию, что в запросе, токеном из запроса', async () => {
    const d = deps()
    await runTabAction(req(), d, NOW)
    expect(d.userCall).toHaveBeenCalledWith(HOST, 'tok', 'crm.company.get', { id: 10 })
  })
})

describe('вкладка компании: действия', () => {
  it('список: статус доступа по записи этой компании', async () => {
    const d = deps({ dir: fakeDir([rec({ companyId: 99 })]) })
    const r = await runTabAction(req(), d, NOW)
    expect(r).toEqual({ status: 200, body: { contacts: [{ id: 5, name: 'Иванов', phones: ['+375291112233'], emails: [], access: 'none', expiresAt: null }] } })
    const d2 = deps({ dir: fakeDir([rec({ status: 'revoked', id: 2 }), rec({ id: 3 })]) })
    expect((await runTabAction(req(), d2, NOW)).body).toMatchObject({ contacts: [{ access: 'active' }] })
  })

  it('выдача: ключ в ответе, кэш проверки сброшен', async () => {
    const d = deps()
    const r = await runTabAction(req({ action: 'issue', contactId: 5 }), d, NOW)
    expect(r.status).toBe(200)
    expect((r.body as { key: string }).key).toMatch(/^[A-Za-z0-9]{16}$/)
    expect(d.forgetAccess).toHaveBeenCalledWith(77)
  })

  it('контакт не из компании и компания без GUID — 409 с понятным текстом', async () => {
    expect(await runTabAction(req({ action: 'issue', contactId: 5 }), deps({ dir: fakeDir([], { inCompany: false }) }), NOW))
      .toEqual({ status: 409, body: { error: 'Контакт не привязан к этой компании' } })
    expect((await runTabAction(req({ action: 'issue', contactId: 5 }), deps({ dir: fakeDir([], { guid: null }) }), NOW)).status).toBe(409)
  })

  it('отзыв по контакту и компании, кэш сброшен; без контакта — 400', async () => {
    const d = deps()
    expect(await runTabAction(req({ action: 'revoke', contactId: 5 }), d, NOW)).toEqual({ status: 200, body: { revoked: 1 } })
    expect(d.dir.revokeAccess).toHaveBeenCalledWith(5, 10)
    expect(d.forgetAccess).toHaveBeenCalled()
    expect((await runTabAction(req({ action: 'revoke' }), deps(), NOW)).status).toBe(400)
  })
})

describe('вкладка компании: чистые правила', () => {
  it('хост: только имя и порт', () => {
    expect(normalizeHost(' B24.Algena.by ')).toBe('b24.algena.by')
    expect(normalizeHost('b24.algena.by:8443')).toBe('b24.algena.by:8443')
    // Так домен отдаёт SDK фрейма (getTargetOrigin) — найдено на коробке: вкладка отвечала «не подключён».
    expect(normalizeHost('https://b24.algena.by')).toBe('b24.algena.by')
    expect(normalizeHost('https://b24.algena.by:443/')).toBe('b24.algena.by')
    for (const bad of ['http://b24.algena.by', 'b24.algena.by/x', 'https://b24.algena.by/x', 'a@b24.algena.by', 'https://a@b24.algena.by', '']) expect(normalizeHost(bad)).toBeNull()
  })

  it('доверенные хосты: явный список, иначе портал установки', () => {
    expect(allowedHosts('a.by, B.by', 'c.by')).toEqual(['a.by', 'b.by'])
    expect(allowedHosts('', 'c.by')).toEqual(['c.by'])
    expect(allowedHosts('', null)).toEqual([])
  })

  it('состояние доступа', () => {
    expect(accessState(undefined, NOW)).toBe('none')
    expect(accessState(rec({ status: 'revoked' }), NOW)).toBe('revoked')
    expect(accessState(rec({ expiresAt: '2026-10-14T09:00:00Z' }), NOW)).toBe('expired')
    expect(accessState(rec({ expiresAt: '2026-10-15T09:00:00Z' }), NOW)).toBe('active')
  })

  it('контакты компании: без повторов, имя и мультиполя', async () => {
    const call = vi.fn(async (method: string, p: Record<string, unknown>) => method === 'crm.company.contact.items.get'
      ? [{ CONTACT_ID: '5' }, { CONTACT_ID: 5 }, { CONTACT_ID: '0' }]
      : { NAME: 'Иван', LAST_NAME: 'Иванов', PHONE: [{ VALUE: '+375 29' }], EMAIL: [{ VALUE: 'a@b.by' }], ID: p.id })
    expect(await listCompanyContacts(call, 10)).toEqual([{ id: 5, name: 'Иванов Иван', phones: ['+375 29'], emails: ['a@b.by'] }])
    expect(call).toHaveBeenCalledTimes(2)
  })
})
