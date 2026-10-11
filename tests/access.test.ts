import { describe, expect, it } from 'vitest'
import { generateAccessKey, hashAccessKey, keyFingerprint, verifyAccessKey } from '../server/utils/accessKeys'
import { clientIp } from '../server/utils/clientIp'
import { signSession, verifySession, SESSION_TTL_SEC } from '../server/utils/session'
import { normalizeLogin } from '../shared/access/login'

const SECRET = 'x'.repeat(32)

describe('ключи доступа', () => {
  it('ключ не короче 12, без похожих символов, каждый раз новый', () => {
    const a = generateAccessKey()
    expect(a).toMatch(/^[A-HJ-NP-Za-hj-km-np-z2-9]{16}$/)
    expect(generateAccessKey()).not.toBe(a)
    expect(() => generateAccessKey(8)).toThrow()
  })

  it('хэш проверяется, чужой ключ — нет, соль разная', async () => {
    const key = generateAccessKey()
    const h1 = await hashAccessKey(key)
    expect(await verifyAccessKey(key, h1)).toBe(true)
    expect(await verifyAccessKey(key + 'x', h1)).toBe(false)
    expect(await hashAccessKey(key)).not.toBe(h1)
  })

  it('испорченный или «тяжёлый» хэш — «не подходит», а не исключение', async () => {
    const big = 'A'.repeat(200)
    for (const bad of ['', 'plain-text-key', 'scrypt$1073741824$8$1$AAAA$AAAAAAAAAAAAAAAAAAAAAA', 'scrypt$131072$16$1$AAAA$AAAAAAAAAAAAAAAAAAAAAA', `scrypt$16384$8$1$AAAA$${big}`, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA', 'scrypt$16384$8$1$AAAA$AAAAAAAAAAAAAAAAAAAAAA$x', 'scrypt$16384$8$1$AAAA$AAAA']) {
      await expect(verifyAccessKey('k', bad)).resolves.toBe(false)
    }
  })

  it('отпечаток меняется при перевыпуске ключа', async () => {
    expect(keyFingerprint(await hashAccessKey('a'.repeat(16)))).not.toBe(keyFingerprint(await hashAccessKey('a'.repeat(16))))
  })
})

describe('логин', () => {
  it('телефон — только цифры, «+375…» и «375…» — один логин; email — нижний регистр', () => {
    expect(normalizeLogin(' +375 (29) 123-45-67 ')).toEqual({ kind: 'PHONE', value: '375291234567' })
    expect(normalizeLogin('375291234567')).toEqual(normalizeLogin('+375291234567'))
    expect(normalizeLogin('Buyer@Example.BY')).toEqual({ kind: 'EMAIL', value: 'buyer@example.by' })
  })
  it('неразборчивое — null', () => {
    for (const bad of ['', '123', 'abc', 'a@b', '+1'.repeat(20)]) expect(normalizeLogin(bad)).toBeNull()
  })
})

describe('адрес клиента за прокси', () => {
  it('берётся правый адрес X-Forwarded-For — его дописал прокси, левые пишет клиент', () => {
    expect(clientIp('6.6.6.6, 203.0.113.9', '172.18.0.2', true)).toBe('203.0.113.9')
  })
  it('без доверия к прокси заголовок не читается', () => {
    expect(clientIp('6.6.6.6', '198.51.100.1', false)).toBe('198.51.100.1')
    expect(clientIp(undefined, undefined, true)).toBe('unknown')
  })
})

describe('сессия', () => {
  const claims = { contactId: 5, companyId: 7, accessId: 9, kf: 'abc' }

  it('подписанная сессия читается до истечения срока', () => {
    const token = signSession(claims, SECRET, 1000)
    expect(verifySession(token, SECRET, 1001)).toMatchObject(claims)
    expect(verifySession(token, SECRET, 1000 + SESSION_TTL_SEC)).toBeNull()
  })

  it('подмена тела, чужой секрет, alg none, нет отпечатка — отказ', () => {
    const token = signSession(claims, SECRET, 1000)
    const [h, , s] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...claims, companyId: 8, iat: 1000, exp: 9e9 })).toString('base64url')
    expect(verifySession(`${h}.${forged}.${s}`, SECRET, 1001)).toBeNull()
    expect(verifySession(token, 'y'.repeat(32), 1001)).toBeNull()
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    expect(verifySession(`${none}.${forged}.`, SECRET, 1001)).toBeNull()
    expect(verifySession(signSession({ ...claims, kf: '' }, SECRET, 1000), SECRET, 1001)).toBeNull()
  })

  it('нулевые id, чужой заголовок и подпись другой длины — отказ', () => {
    expect(verifySession(signSession({ ...claims, contactId: 0 }, SECRET, 1000), SECRET, 1001)).toBeNull()
    expect(verifySession(signSession({ ...claims, companyId: -1 }, SECRET, 1000), SECRET, 1001)).toBeNull()
    const token = signSession(claims, SECRET, 1000)
    const [h, b, s] = token.split('.')
    expect(verifySession(`${h}.${b}.${s!.slice(0, -2)}`, SECRET, 1001)).toBeNull()
    const hs512 = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString('base64url')
    expect(verifySession(`${hs512}.${b}.${s}`, SECRET, 1001)).toBeNull()
  })

  it('короткий секрет не подписывает и не проверяет', () => {
    expect(() => signSession(claims, 'short')).toThrow()
    expect(verifySession(signSession(claims, SECRET), 'short')).toBeNull()
  })
})
