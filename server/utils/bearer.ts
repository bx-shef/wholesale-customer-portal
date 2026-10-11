import { timingSafeEqual } from 'node:crypto'

/**
 * Достаёт токен из заголовка `Authorization: Bearer <токен>`.
 * Регистр схемы не важен (RFC 6750); пустой токен — как отсутствующий.
 */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  return match ? match[1]! : null
}

/**
 * Сверка присланного токена с ожидаемым за постоянное время.
 * Не задан ожидаемый (пустая переменная окружения) — отказ всегда: доступ к /mcp/admin
 * без настроенного токена не открывается никому (fail-closed).
 */
export function bearerMatches(presented: string | null, expected: string | undefined): boolean {
  if (!presented || !expected) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
