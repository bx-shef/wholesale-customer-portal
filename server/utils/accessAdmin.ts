/**
 * Выдача и отзыв ключей доступа (docs/spec.md §3) — общая логика для /mcp/admin и будущей
 * вкладки компании. Ключ возвращается один раз и нигде не хранится: в CRM — только хэш.
 */
import type { AccessDirectory } from '../services/b24Access'
import { generateAccessKey, hashAccessKey } from './accessKeys'

export const MAX_TTL_DAYS = 3650

export type IssueResult =
  | { ok: true, accessId: number, key: string, expiresAt: string | null }
  | { ok: false, error: 'contact_not_in_company' | 'company_without_guid' | 'bad_ttl' }

export async function issueAccessKey(
  dir: AccessDirectory,
  input: { contactId: number, companyId: number, ttlDays?: number },
  now = new Date(),
): Promise<IssueResult> {
  if (input.ttlDays !== undefined && (!Number.isInteger(input.ttlDays) || input.ttlDays < 1 || input.ttlDays > MAX_TTL_DAYS)) return { ok: false, error: 'bad_ttl' }
  // Ключ только контакту этой компании: иначе ЛК открыл бы цены компании постороннему.
  if (!(await dir.contactInCompany(input.contactId, input.companyId))) return { ok: false, error: 'contact_not_in_company' }
  const company = await dir.getCompany(input.companyId)
  if (!company?.onecGuid) return { ok: false, error: 'company_without_guid' }
  const key = generateAccessKey()
  const expiresAt = input.ttlDays ? new Date(now.getTime() + input.ttlDays * 86_400_000) : null
  const accessId = await dir.upsertAccess(input.contactId, input.companyId, hashAccessKey(key), expiresAt)
  return { ok: true, accessId, key, expiresAt: expiresAt?.toISOString() ?? null }
}
