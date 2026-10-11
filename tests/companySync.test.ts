import { describe, expect, it } from 'vitest'
import { createCompanySync } from '../server/services/b24Companies'
import { generateSeed } from '../server/mocks/onec/seed'

/** CRM в памяти: компании с полем GUID; user.get отдаёт всех — как портал, проигнорировавший фильтр. */
function fakeCrm() {
  const companies = new Map<number, Record<string, unknown>>()
  let next = 1
  const calls: string[] = []
  const call = async (method: string, p: Record<string, unknown>) => {
    calls.push(method)
    switch (method) {
      case 'crm.item.fields': return { fields: { id: {}, title: {}, ufCrm1cGuid: {} } }
      case 'crm.item.list': {
        const guid = (p.filter as Record<string, string>).ufCrm1cGuid
        return { items: [...companies.values()].filter(c => c.ufCrm1cGuid === guid) }
      }
      case 'crm.item.add': { const id = next++; companies.set(id, { id, ...(p.fields as object) }); return { item: { id } } }
      case 'crm.item.update': { Object.assign(companies.get(Number(p.id))!, p.fields); return { item: {} } }
      case 'user.get': return [{ ID: '3', EMAIL: 'manager1@example.by' }, { ID: '4', EMAIL: 'manager2@example.by' }]
      default: throw new Error(method)
    }
  }
  return { call, companies, calls }
}

describe('клиенты 1С → компании Б24', () => {
  it('первый прогон создаёт, повторный обновляет — дублей нет', async () => {
    const crm = fakeCrm()
    const { clients } = generateSeed(1)
    const sync = createCompanySync(crm.call)
    expect(await sync.upsert(clients)).toEqual({ created: 5, updated: 0, skippedDeleted: 0 })
    expect(await sync.upsert(clients)).toEqual({ created: 0, updated: 5, skippedDeleted: 0 })
    expect(crm.companies.size).toBe(5)
  })

  it('ответственный — по email менеджера, а не первый попавшийся сотрудник', async () => {
    const crm = fakeCrm()
    const [client] = generateSeed(1).clients
    await createCompanySync(crm.call).upsert([{ ...client!, managerEmail: 'Manager2@Example.BY' }])
    expect([...crm.companies.values()][0]).toMatchObject({ assignedById: 4, title: client!.name })
    await createCompanySync(crm.call).upsert([{ ...client!, guid: '11111111-1111-4111-8111-111111111111', managerEmail: 'nobody@example.by' }])
    expect([...crm.companies.values()][1]).not.toHaveProperty('assignedById')
  })

  it('пометка удаления в 1С компанию в CRM не трогает', async () => {
    const crm = fakeCrm()
    const [client] = generateSeed(1).clients
    expect(await createCompanySync(crm.call).upsert([{ ...client!, deleted: true }])).toEqual({ created: 0, updated: 0, skippedDeleted: 1 })
    expect(crm.calls).not.toContain('crm.item.add')
    expect(crm.calls).not.toContain('crm.item.update')
  })
})

describe('профиль', () => {
  it('договор из 1С по GUID компании, менеджер — ответственный; сбой 1С не прячет менеджера', async () => {
    const { loadProfile } = await import('../server/utils/profile')
    const company = { id: 7, title: 'ООО', onecGuid: 'g', assignedById: 3 }
    const directory = { getCompany: async () => company } as never
    const call = async () => [{ ID: '9', NAME: 'Чужой' }, { ID: '3', NAME: 'Анна', LAST_NAME: 'Иванова', WORK_PHONE: '+375171234567', EMAIL: 'a@x.by' }]
    const contract = { guid: 'c', number: 'ОПТ-1', date: '2026-01-01', priceTypeGuid: 'p', paymentDelayDays: 14, creditLimit: 5000, debt: 0, currency: 'BYN' }
    const ok = await loadProfile(7, { directory, call, onec: () => ({ contract: async () => contract }) as never })
    expect(ok).toEqual({ company: { id: 7, title: 'ООО' }, contract, manager: { name: 'Анна Иванова', phone: '+375171234567', email: 'a@x.by' } })
    const broken = await loadProfile(7, { directory, call, onec: () => ({ contract: async () => { throw new Error('503') } }) as never })
    expect(broken.contract).toBeNull()
    expect(broken.manager?.name).toBe('Анна Иванова')
  })
})

describe('профиль — ошибки', () => {
  it('компании нет — 404, а не 500', async () => {
    const { loadProfile } = await import('../server/utils/profile')
    const e = await loadProfile(7, { directory: { getCompany: async () => null } as never, call: async () => [], onec: () => ({}) as never }).catch((x: unknown) => x)
    expect(e).toMatchObject({ statusCode: 404 })
  })
})
