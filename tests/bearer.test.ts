import { describe, expect, it } from 'vitest'
import { bearerMatches, parseBearer } from '../server/utils/bearer'

describe('parseBearer', () => {
  it('достаёт токен, регистр схемы не важен', () => {
    expect(parseBearer('Bearer abc')).toBe('abc')
    expect(parseBearer('bearer abc')).toBe('abc')
  })
  it('отвергает пустое и чужие схемы', () => {
    expect(parseBearer(undefined)).toBeNull()
    expect(parseBearer('')).toBeNull()
    expect(parseBearer('Bearer ')).toBeNull()
    expect(parseBearer('Basic abc')).toBeNull()
    expect(parseBearer('Bearer a b')).toBeNull()
  })
})

describe('bearerMatches', () => {
  it('принимает совпавший токен', () => {
    expect(bearerMatches('secret', 'secret')).toBe(true)
  })
  it('отвергает чужой и другой длины', () => {
    expect(bearerMatches('secreT', 'secret')).toBe(false)
    expect(bearerMatches('secret1', 'secret')).toBe(false)
  })
  it('без настроенного токена закрыт для всех, даже для пустого', () => {
    expect(bearerMatches('', '')).toBe(false)
    expect(bearerMatches('x', '')).toBe(false)
    expect(bearerMatches('x', undefined)).toBe(false)
    expect(bearerMatches(null, 'secret')).toBe(false)
  })
})
