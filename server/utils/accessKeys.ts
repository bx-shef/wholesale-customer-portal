/**
 * Ключи доступа к ЛК (docs/spec.md §3): ключ показывается менеджеру один раз, в CRM хранится
 * только хэш. Хэш — scrypt из node:crypto с солью: медленный по памяти и времени, без нативных
 * зависимостей (argon2/bcrypt в образе потребовали бы сборки). Формат строки самоописывающий —
 * параметры можно усилить позже, старые хэши продолжат проверяться.
 */
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'

/** Без похожих символов (0/O, 1/l/I): ключ диктуют по телефону и переписывают с SMS. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
export const KEY_LENGTH = 16
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 }

export function generateAccessKey(length = KEY_LENGTH): string {
  if (length < 12) throw new Error('Access key must be at least 12 characters')
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
}

export function hashAccessKey(key: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(key, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

/** Проверка за постоянное время; испорченный или чужой формат хэша — просто «не подходит». */
export function verifyAccessKey(key: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, salt, hash] = parts as [string, string, string, string, string, string]
  const N = Number(n)
  // Потолок параметров: подложенный в CRM хэш с N=2^30 не должен класть сервер.
  if (![N, Number(r), Number(p)].every(Number.isInteger) || N > 1 << 17 || Number(r) > 16 || Number(p) > 4) return false
  const expected = Buffer.from(hash, 'base64url')
  if (expected.length < 16) return false
  const actual = scryptSync(key, Buffer.from(salt, 'base64url'), expected.length, { N, r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 })
  return timingSafeEqual(actual, expected)
}
