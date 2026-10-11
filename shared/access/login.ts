/**
 * Логин сотрудника клиента — телефон или email контакта компании в CRM (docs/spec.md §3).
 * Нормализуем до поиска: телефон — только цифры (с ведущим «+»), email — в нижнем регистре.
 * Неразборчивое — null, до CRM такой запрос не доходит.
 */
export type LoginKind = 'PHONE' | 'EMAIL'

export interface NormalizedLogin {
  kind: LoginKind
  value: string
}

export function normalizeLogin(raw: string): NormalizedLogin | null {
  const value = raw.trim()
  if (value.length === 0 || value.length > 254) return null
  if (value.includes('@')) {
    const email = value.toLowerCase()
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { kind: 'EMAIL', value: email } : null
  }
  const digits = value.replace(/[\s()\-.]/g, '')
  if (!/^\+?\d{7,15}$/.test(digits)) return null
  return { kind: 'PHONE', value: digits }
}
