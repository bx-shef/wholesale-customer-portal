/**
 * Компании из 1С → компании CRM коробки (docs/spec.md §1, поток `onec_companies` →
 * `b24_upsert_company`). Компанию заводят в 1С; ЛК создаёт или обновляет её в Б24 по
 * `UF_CRM_1C_GUID` — идемпотентно: повторная синхронизация того же клиента ничего не плодит.
 *
 * Ответственный — сотрудник портала с email менеджера из 1С; не нашли — поле не трогаем.
 * Пометку удаления в 1С (`deleted`) в CRM не переносим: удалять компании поставщика ЛК не вправе
 * (docs/AGENT_RULES.md §5.8), такая компания просто перестаёт обновляться.
 */
import type { ClientT } from '../../shared/onec/schemas'
import { COMPANY_GUID_FIELD } from '../../shared/b24Setup'
import { resolveFieldKey, type B24Call } from './b24Access'

export interface UpsertSummary {
  created: number
  updated: number
  skippedDeleted: number
}

export function createCompanySync(call: B24Call) {
  let guidKey: Promise<string> | undefined
  const getGuidKey = () => (guidKey ??= (async () => {
    const { fields } = await call('crm.item.fields', { entityTypeId: 4 }) as { fields: Record<string, unknown> }
    const key = resolveFieldKey(Object.keys(fields), COMPANY_GUID_FIELD)
    if (!key) throw new Error(`Company field ${COMPANY_GUID_FIELD} not found — run pnpm b24:setup`)
    return key
  })().catch((e) => {
    guidKey = undefined
    throw e
  }))

  async function userIdByEmail(email: string, cache: Map<string, number | null>): Promise<number | null> {
    const key = email.trim().toLowerCase()
    if (!key) return null
    if (!cache.has(key)) {
      const users = await call('user.get', { FILTER: { EMAIL: key, ACTIVE: true } }) as { ID: string, EMAIL?: string }[]
      // Фильтр перепроверяем: непонятый портал отдал бы всех сотрудников.
      const match = users.filter(u => (u.EMAIL ?? '').toLowerCase() === key)
      cache.set(key, match.length === 1 ? Number(match[0]!.ID) : null)
    }
    return cache.get(key)!
  }

  return {
    async upsert(clients: ClientT[]): Promise<UpsertSummary> {
      const guid = await getGuidKey()
      const managers = new Map<string, number | null>()
      const summary: UpsertSummary = { created: 0, updated: 0, skippedDeleted: 0 }
      for (const client of clients) {
        const { items } = await call('crm.item.list', { entityTypeId: 4, filter: { [guid]: client.guid }, select: ['id', guid] }) as { items: Record<string, unknown>[] }
        const existing = items.filter(i => String(i[guid] ?? '').toLowerCase() === client.guid.toLowerCase())
        if (client.deleted) {
          summary.skippedDeleted++
          continue
        }
        const assignedById = await userIdByEmail(client.managerEmail, managers)
        const fields: Record<string, unknown> = {
          title: client.name,
          [guid]: client.guid,
          ...(assignedById ? { assignedById } : {}),
        }
        if (existing.length > 0) {
          await call('crm.item.update', { entityTypeId: 4, id: Number(existing[0]!.id), fields })
          summary.updated++
        }
        else {
          await call('crm.item.add', { entityTypeId: 4, fields })
          summary.created++
        }
      }
      return summary
    },
  }
}
