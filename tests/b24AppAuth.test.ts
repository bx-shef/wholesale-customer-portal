import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { migrate } from '../server/db/sqlite'
import { acceptInstall, loadAppAuth, parseInstallPayload, safeServerEndpoint, saveAppAuth, type InstallPayload, type TokenFetch } from '../server/utils/b24AppAuth'
import { COMPANY_GUID_FIELD, DEAL_CATEGORY_NAME, SMART_PROCESSES, spFieldName } from '../shared/b24Setup'
import { readPortalState, runSetup } from '../shared/b24SetupRun'

const CREDS = { clientId: 'local.abc', clientSecret: 's3cret' }
const P: InstallPayload = { domain: 'crm.algena.by', memberId: 'm1', refreshToken: 'r0', serverEndpoint: 'https://oauth.bitrix.info/rest/' }

function oauth(body: Record<string, unknown>, ok = true) {
  return vi.fn<TokenFetch>(async () => ({ ok, json: async () => body }))
}
const GOOD = { access_token: 'a1', refresh_token: 'r1', expires_in: 3600, member_id: 'm1', client_endpoint: 'https://crm.algena.by/rest/', server_endpoint: 'https://oauth.bitrix.info/rest/' }

describe('установка приложения: разбор', () => {
  it('нужны DOMAIN, member_id и REFRESH_ID; сервер авторизации — только облачный', () => {
    expect(parseInstallPayload({ member_id: 'm1', REFRESH_ID: 'r0', AUTH_ID: 'a0' }, { DOMAIN: 'CRM.algena.by' })).toEqual(P)
    expect(parseInstallPayload({ member_id: 'm1' }, { DOMAIN: 'x' })).toBeNull()
    expect(parseInstallPayload(null, { DOMAIN: 'x' })).toBeNull()
    expect(parseInstallPayload({ member_id: 'm1', REFRESH_ID: 'r0', SERVER_ENDPOINT: 'https://evil.by/rest/' }, { DOMAIN: 'x' })).toBeNull()
  })

  it('адрес сервера авторизации', () => {
    expect(safeServerEndpoint(undefined)).toBe('https://oauth.bitrix.info/rest/')
    expect(safeServerEndpoint('https://oauth.bitrix.info/rest/')).toBe('https://oauth.bitrix.info/rest/')
    for (const bad of ['http://oauth.bitrix.info/rest/', 'https://u:p@oauth.bitrix.info/rest/', 'https://oauth.bitrix.info.evil.by/', 'мусор']) expect(safeServerEndpoint(bad)).toBeNull()
  })
})

describe('установка приложения: проверка продлением', () => {
  it('портал не из B24_PORTAL_HOST и нет ключей — отказ без похода в сеть', async () => {
    const f = oauth(GOOD)
    expect((await acceptInstall(P, { allowedHosts: ['other.by'], creds: CREDS, fetch: f })).ok).toBe(false)
    expect((await acceptInstall(P, { allowedHosts: [P.domain], creds: null, fetch: f })).ok).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })

  it('продлевает присланный токен нашими ключами и сохраняет НОВУЮ пару', async () => {
    const f = oauth(GOOD)
    const r = await acceptInstall(P, { allowedHosts: [P.domain], creds: CREDS, fetch: f, now: 1_000 })
    expect(r).toEqual({ ok: true, auth: { domain: P.domain, memberId: 'm1', accessToken: 'a1', refreshToken: 'r1', expiresAt: 1_000 + 3_600_000, serverEndpoint: 'https://oauth.bitrix.info/rest/' } })
    const [url, body] = f.mock.calls[0]!
    expect(url).toBe('https://oauth.bitrix.info/oauth/token/')
    expect(Object.fromEntries(body)).toEqual({ grant_type: 'refresh_token', client_id: 'local.abc', client_secret: 's3cret', refresh_token: 'r0' })
  })

  it('токен чужого портала или отказ сервера авторизации — отказ', async () => {
    const deps = (f: TokenFetch) => ({ allowedHosts: [P.domain], creds: CREDS, fetch: f })
    expect((await acceptInstall(P, deps(oauth({ ...GOOD, member_id: 'm2' })))).ok).toBe(false)
    expect((await acceptInstall(P, deps(oauth({ ...GOOD, client_endpoint: 'https://evil.by/rest/' })))).ok).toBe(false)
    expect((await acceptInstall(P, deps(oauth({ error: 'invalid_grant' }, false)))).ok).toBe(false)
    expect((await acceptInstall(P, deps(vi.fn(async () => { throw new Error('net') })))).ok).toBe(false)
  })

  it('хранение: одна строка, переустановка перезаписывает', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    expect(loadAppAuth(db)).toBeNull()
    const a = { domain: 'crm.algena.by', memberId: 'm1', accessToken: 'a1', refreshToken: 'r1', expiresAt: 5, serverEndpoint: 'https://oauth.bitrix.info/rest/' }
    saveAppAuth(db, a)
    saveAppAuth(db, { ...a, refreshToken: 'r2' })
    expect(loadAppAuth(db)).toEqual({ ...a, refreshToken: 'r2' })
    expect(db.prepare('SELECT count(*) AS n FROM b24_app_auth').get()).toEqual({ n: 1 })
  })
})

/** Портал в памяти: отвечает на чтение настройки и запоминает созданное. */
function fakePortal(opts: { extraTypes?: number } = {}) {
  const state = {
    companyFields: [] as string[],
    types: Array.from({ length: opts.extraTypes ?? 0 }, (_, i) => ({ id: 100 + i, entityTypeId: 2000 + i, title: `Чужой ${i}` })),
    fields: new Map<number, string[]>(),
    categories: [] as string[],
  }
  const call = vi.fn(async (method: string, p: Record<string, unknown>): Promise<unknown> => {
    const start = Number(p.start ?? 0)
    const page = <T>(rows: T[]) => rows.slice(start, start + 50)
    switch (method) {
      case 'crm.company.userfield.list': return page(state.companyFields.map(f => ({ FIELD_NAME: f })))
      case 'crm.type.list': return { types: page(state.types) }
      case 'userfieldconfig.list': {
        const id = Number(String((p.filter as { entityId: string }).entityId).replace('CRM_', ''))
        return { fields: page((state.fields.get(id) ?? []).map(fieldName => ({ fieldName }))) }
      }
      case 'crm.category.list': return { categories: page(state.categories.map(name => ({ name }))) }
      case 'crm.company.userfield.add': state.companyFields.push(COMPANY_GUID_FIELD)
        return 1
      case 'crm.type.add': {
        const id = 10 + state.types.length
        state.types.push({ id, entityTypeId: 1000 + id, title: String((p.fields as { title: string }).title) })
        return { type: { id } }
      }
      case 'userfieldconfig.add': {
        const f = p.field as { entityId: string, fieldName: string }
        const id = Number(f.entityId.replace('CRM_', ''))
        state.fields.set(id, [...(state.fields.get(id) ?? []), f.fieldName])
        return { field: {} }
      }
      case 'crm.category.add': state.categories.push(DEAL_CATEGORY_NAME)
        return { category: {} }
      default: throw new Error(`unexpected ${method}`)
    }
  })
  return { state, call }
}

describe('настройка CRM токеном приложения', () => {
  it('без apply только план: портал не меняется', async () => {
    const { state, call } = fakePortal()
    const r = await runSetup(call, false)
    expect(r.done).toBe(false)
    expect(r.lines.every(l => l.startsWith('plan '))).toBe(true)
    expect(state.types).toHaveLength(0)
  })

  it('с apply за один запуск доводит до конца, включая поля нового смарт-процесса', async () => {
    const { state, call } = fakePortal()
    const r = await runSetup(call, true)
    expect(r.done).toBe(true)
    expect(state.types.map(t => t.title)).toEqual(SMART_PROCESSES.map(sp => sp.title))
    for (const [i, sp] of SMART_PROCESSES.entries()) expect(state.fields.get(10 + i)).toEqual(sp.fields.map(f => spFieldName(10 + i, f.postfix)))
    expect(await runSetup(call, true)).toEqual({ lines: [], pending: [], done: true })
  })

  it('читает списки постранично: «Доступ в ЛК» за 50-м смарт-процессом не создаётся повторно', async () => {
    const { state, call } = fakePortal({ extraTypes: 60 })
    await runSetup(call, true)
    const before = state.types.length
    await runSetup(call, true)
    expect(state.types.length).toBe(before)
    expect((await readPortalState(call)).smartProcesses).toHaveLength(60 + SMART_PROCESSES.length)
  })
})
