/**
 * Ключи доступа к ЛК (docs/spec.md §3): ключ показывается менеджеру один раз, в CRM хранится
 * только хэш. Хэш — scrypt из node:crypto с солью: медленный по памяти и времени, без нативных
 * зависимостей (argon2/bcrypt в образе потребовали бы сборки). Формат строки самоописывающий —
 * параметры можно усилить позже, старые хэши продолжат проверяться.
 *
 * scrypt — асинхронный (пул потоков libuv): синхронный блокировал бы весь сервер на каждый вход.
 */
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto'

/** Без похожих символов (0/O, 1/l/I): ключ диктуют по телефону и переписывают с SMS. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
export const KEY_LENGTH = 16
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 }
/** Потолок параметров чужого хэша: подложенный в CRM хэш не должен класть сервер. 128·N·r ≤ 32 МБ. */
const LIMITS = { N: 1 << 15, r: 8, p: 2, hashBytes: 64 }

function scryptAsync(key: string, salt: Buffer, keylen: number, opts: { N: number, r: number, p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(key, salt, keylen, { ...opts, maxmem: 64 * 1024 * 1024 }, (e, out) => (e ? reject(e) : resolve(out))))
}

export function generateAccessKey(length = KEY_LENGTH): string {
  if (length < 12) throw new Error('Access key must be at least 12 characters')
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
}

export async function hashAccessKey(key: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(key, salt, SCRYPT.keylen, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

/** Проверка за постоянное время; испорченный, чужой или «тяжёлый» хэш — просто «не подходит». */
export async function verifyAccessKey(key: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, salt, hash] = parts as [string, string, string, string, string, string]
  const params = { N: Number(n), r: Number(r), p: Number(p) }
  if (!Object.values(params).every(v => Number.isInteger(v) && v > 0)) return false
  if (params.N > LIMITS.N || params.r > LIMITS.r || params.p > LIMITS.p) return false
  const expected = Buffer.from(hash, 'base64url')
  if (expected.length < 16 || expected.length > LIMITS.hashBytes) return false
  try {
    return timingSafeEqual(await scryptAsync(key, Buffer.from(salt, 'base64url'), expected.length, params), expected)
  }
  catch {
    return false
  }
}

/** Хэш-заглушка для «холостой» проверки: отказ без контакта занимает столько же времени, сколько с ним. */
let dummy: Promise<string> | undefined
export async function burnVerifyTime(key: string): Promise<void> {
  await verifyAccessKey(key, await (dummy ??= hashAccessKey(generateAccessKey())))
}

/**
 * Отпечаток хэша ключа — в сессию: перевыпуск ключа меняет хэш, и сессии, открытые прежним
 * (возможно, утёкшим) ключом, закрываются при ближайшей перепроверке.
 */
export function keyFingerprint(keyHash: string): string {
  return createHash('sha256').update(keyHash).digest('base64url').slice(0, 16)
}
