/**
 * Профиль сотрудника клиента (docs/spec.md, «Профиль»): компания из CRM, договор из 1С,
 * менеджер — ответственный за компанию. Только данные компании из сессии.
 */
import type { ContractT } from '../../shared/onec/schemas'
import type { AccessDirectory, B24Call } from '../services/b24Access'
import type { OnecClient } from '../services/onec'

export interface Profile {
  company: { id: number, title: string }
  contract: ContractT | null
  manager: { name: string, phone: string | null, email: string | null } | null
}

export async function loadProfile(
  companyId: number,
  deps: { directory: AccessDirectory, call: B24Call, onec: () => OnecClient },
): Promise<Profile> {
  const company = await deps.directory.getCompany(companyId)
  if (!company) throw new Error(`Company ${companyId} not found`)

  // Договор и менеджер — не обязательны для показа профиля: сбой одного не прячет остальное.
  const contract = company.onecGuid
    ? await deps.onec().contract(company.onecGuid).catch((e: unknown) => {
        console.error(`[profile] contract: ${(e as Error).message}`)
        return null
      })
    : null

  let manager: Profile['manager'] = null
  if (company.assignedById) {
    try {
      const users = await deps.call('user.get', { FILTER: { ID: company.assignedById } }) as Record<string, string | undefined>[]
      const u = users.find(x => Number(x.ID) === company.assignedById)
      if (u) {
        manager = {
          name: [u.NAME, u.LAST_NAME].filter(Boolean).join(' ') || 'Менеджер',
          phone: u.WORK_PHONE || u.PERSONAL_MOBILE || null,
          email: u.EMAIL || null,
        }
      }
    }
    catch (e) {
      console.error(`[profile] manager: ${(e as Error).message}`)
    }
  }

  return { company: { id: company.id, title: company.title }, contract, manager }
}
