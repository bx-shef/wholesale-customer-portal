import { describe, expect, it, vi } from 'vitest'
import { hashAccessKey, keyFingerprint } from '../server/utils/accessKeys'
import type { AccessRecord } from '../server/services/b24Access'

// clientSession.ts зовёт авто-импорты Nitro только в resolveClientSession; accessStillValid — чистая.
vi.stubGlobal('useAccessDirectory', () => { throw new Error('not used') })
const { accessStillValid, ACCESS_RECHECK_MS, CRM_OUTAGE_GRACE_MS, forgetAccessCheck } = await import('../server/utils/clientSession')

const hash = await hashAccessKey('AbcdEfghJkmn2345')
const rec = (over: Partial<AccessRecord> = {}): AccessRecord => ({ id: 11, contactId: 5, companyId: 7, keyHash: hash, status: 'active', expiresAt: null, ...over })
const claims = (over = {}) => ({ contactId: 5, companyId: 7, accessId: 11, kf: keyFingerprint(hash), iat: 1, exp: 9e9, ...over })

describe('перепроверка сессии', () => {
  it('перевыпуск ключа закрывает сессии прежнего ключа', async () => {
    forgetAccessCheck()
    const reissued = rec({ keyHash: await hashAccessKey('NewKeyNewKey2345') })
    expect(await accessStillValid(claims(), async () => reissued, 1000)).toBe(false)
  })

  it('чужая компания в сессии — отказ', async () => {
    forgetAccessCheck()
    expect(await accessStillValid(claims({ companyId: 8 }), async () => rec(), 1000)).toBe(false)
  })

  it('простой CRM: недавно проверенная сессия живёт льготу, дольше — нет; отказ не кэшируется', async () => {
    forgetAccessCheck()
    const down = async () => { throw new Error('ECONNRESET') }
    expect(await accessStillValid(claims(), async () => rec(), 0)).toBe(true)
    const t = ACCESS_RECHECK_MS + 1
    expect(await accessStillValid(claims(), down, t)).toBe(true)
    expect(await accessStillValid(claims(), down, CRM_OUTAGE_GRACE_MS + 1)).toBe(false)
    // CRM вернулась — сразу «ок», без двухминутного отказа из кэша.
    expect(await accessStillValid(claims(), async () => rec(), CRM_OUTAGE_GRACE_MS + 2)).toBe(true)
  })

  it('новая сессия при недоступной CRM не получает доверия', async () => {
    forgetAccessCheck()
    expect(await accessStillValid(claims(), async () => { throw new Error('503') }, 0)).toBe(false)
  })

  it('отозванный, истёкший или чужой контакт закрывают сессию', async () => {
    for (const r of [rec({ status: 'revoked' }), rec({ expiresAt: '1970-01-01T00:00:00Z' }), rec({ contactId: 6 }), null]) {
      forgetAccessCheck()
      expect(await accessStillValid(claims(), async () => r, 1000)).toBe(false)
    }
  })

  it('в пределах ACCESS_RECHECK_MS CRM не спрашиваем, после — спрашиваем', async () => {
    forgetAccessCheck()
    const get = vi.fn(async () => rec())
    await accessStillValid(claims(), get, 0)
    await accessStillValid(claims(), get, ACCESS_RECHECK_MS - 1)
    expect(get).toHaveBeenCalledTimes(1)
    await accessStillValid(claims(), get, ACCESS_RECHECK_MS + 1)
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('отрицательный ответ при падении CRM льготы не даёт', async () => {
    forgetAccessCheck()
    expect(await accessStillValid(claims(), async () => rec({ status: 'revoked' }), 0)).toBe(false)
    expect(await accessStillValid(claims(), async () => { throw new Error('503') }, ACCESS_RECHECK_MS + 1)).toBe(false)
  })
})
