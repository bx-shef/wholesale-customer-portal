import type { H3Event } from 'h3'

/** Сессия сотрудника клиента: кто вошёл и от какой компании (docs/spec.md, «Вход»). */
export interface ClientSession {
  contactId: number
  companyId: number
}

/**
 * Сессия клиента из запроса. Вход по ключу и JWT в cookie — этап 2 (docs/plan.md); до него
 * сессии нет ни у кого, и /mcp/client закрыт целиком.
 */
export function resolveClientSession(_event: H3Event): ClientSession | null {
  return null
}
