/**
 * Сверка «коробка ↔ 1С» (решение владельца 2026-10-23): последние изменённые компании из обмена 1С
 * и есть ли такой клиент с соглашением в подключённой 1С. Отвечает на вопрос, войдут ли клиенты
 * коробки в ЛК при тестовой 1С. Только чтение: CRM — один список, 1С — по клиенту за раз.
 */
import type { B24Call } from '../services/b24Access'
import type { ClientT } from '../../shared/onec/schemas'
import { companyOnecGuid, ONEC_ORIGINATOR } from '../../shared/onecLink'

export const GUID_CHECK_LIMIT = 5

export interface GuidCheckRow {
  companyId: number
  title: string
  guid: string | null
  /** found — клиент есть и с соглашением; no-contract — есть без соглашения; missing — нет в 1С; error — 1С не ответила. */
  onec: 'found' | 'no-contract' | 'missing' | 'error'
}

export async function checkCompanyGuids(call: B24Call, clientByGuid: (guid: string) => Promise<ClientT | null>, limit = GUID_CHECK_LIMIT): Promise<GuidCheckRow[]> {
  const { items } = await call('crm.item.list', {
    entityTypeId: 4,
    filter: { originatorId: ONEC_ORIGINATOR },
    order: { updatedTime: 'DESC' },
    select: ['id', 'title', 'originatorId', 'originId', 'updatedTime'],
    start: 0,
  }) as { items: Record<string, unknown>[] }
  const rows: GuidCheckRow[] = []
  // По одной: 1С бережём, и сверка — редкое действие с кнопки.
  for (const item of items.slice(0, limit)) {
    const guid = companyOnecGuid(item)
    let onec: GuidCheckRow['onec'] = 'missing'
    if (guid) {
      try {
        const client = await clientByGuid(guid)
        onec = !client ? 'missing' : client.contract ? 'found' : 'no-contract'
      }
      catch {
        onec = 'error'
      }
    }
    rows.push({ companyId: Number(item.id), title: String(item.title ?? ''), guid, onec })
  }
  return rows
}
