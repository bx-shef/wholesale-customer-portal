import { describe, expect, it } from 'vitest'
import { generateAccessKey, hashAccessKey, verifyAccessKey } from '../server/utils/accessKeys'
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

  it('хэш проверяется, чужой ключ — нет, соль разная', () => {
    const key = generateAccessKey()
    const h1 = hashAccessKey(key)
    expect(verifyAccessKey(key, h1)).toBe(true)
    expect(verifyAccessKey(key + 'x', h1)).toBe(false)
    expect(hashAccessKey(key)).not.toBe(h1)
  })

  it('испорченный или «тяжёлый» хэш — отказ, а не исключение и не зависание', () => {
    expect(verifyAccessKey('k', '')).toBe(false)
    expect(verifyAccessKey('k', 'plain-text-key')).toBe(false)
    expect(verifyAccessKey('k', 'scrypt$1073741824$8$1$AAAA$AAAAAAAAAAAAAAAAAAAAAA')).toBe(false)
  })
})

describe('логин', () => {
  it('телефон — цифры с плюсом, email — нижний регистр', () => {
    expect(normalizeLogin(' +375 (29) 123-45-67 ')).toEqual({ kind: 'PHONE', value: '+375291234567' })
    expect(normalizeLogin('Buyer@Example.BY')).toEqual({ kind: 'EMAIL', value: 'buyer@example.by' })
  })
  it('неразборчивое — null', () => {
    for (const bad of ['', '123', 'abc', 'a@b', '+1'.repeat(20)]) expect(normalizeLogin(bad)).toBeNull()
  })
})

describe('сессия', () => {
  const claims = { contactId: 5, companyId: 7, accessId: 9 }

  it('подписанная сессия читается до истечения срока', () => {
    const token = signSession(claims, SECRET, 1000)
    expect(verifySession(token, SECRET, 1001)).toMatchObject(claims)
    expect(verifySession(token, SECRET, 1000 + SESSION_TTL_SEC)).toBeNull()
  })

  it('подмена тела, чужой секрет, alg none — отказ', () => {
    const token = signSession(claims, SECRET, 1000)
    const [h, , s] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...claims, companyId: 8, iat: 1000, exp: 9e9 })).toString('base64url')
    expect(verifySession(`${h}.${forged}.${s}`, SECRET, 1001)).toBeNull()
    expect(verifySession(token, 'y'.repeat(32), 1001)).toBeNull()
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    expect(verifySession(`${none}.${forged}.`, SECRET, 1001)).toBeNull()
  })

  it('короткий секрет не подписывает и не проверяет', () => {
    expect(() => signSession(claims, 'short')).toThrow()
    expect(verifySession(signSession(claims, SECRET), 'short')).toBeNull()
  })
})
