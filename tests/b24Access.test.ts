import { describe, expect, it } from 'vitest'
import { createB24AccessDirectory, resolveFieldKey, type B24Call } from '../server/services/b24Access'

const TYPE_ID = 3
const ETID = 1040
// Ключи — в camelCase, как их отдаёт crm.item.*; resolveFieldKey должен найти их по исходному коду.
const F = { keyHash: `ufCrm${TYPE_ID}KeyHash`, status: `ufCrm${TYPE_ID}Status`, expiresAt: `ufCrm${TYPE_ID}ExpiresAt`, lastLogin: `ufCrm${TYPE_ID}LastLogin` }
const COMPANY_GUID = '3fbebdf8-bd8b-11f1-b86f-00155d008d05'

interface Item { id: number, contactId: number, companyId: number, [k: string]: unknown }

function fakePortal(items: Item[], opts: { ignoreFilter?: boolean, companies?: Record<number, number[]> } = {}) {
  const calls: { method: string, params: Record<string, unknown> }[] = []
  let failMeta = false
  const call: B24Call = async (method, params) => {
    calls.push({ method, params })
    if (failMeta && method === 'crm.type.list') throw new Error('503')
    switch (method) {
      case 'crm.type.list': return { types: [{ id: TYPE_ID, entityTypeId: ETID, title: 'Доступ в ЛК' }] }
      case 'crm.item.fields': return { fields: Object.fromEntries(['id', ...Object.values(F)].map(k => [k, {}])) }
      case 'crm.item.get': {
        if (params.entityTypeId !== 4) break
        if (params.id === 7) return { item: { id: 7, title: 'ООО Опт', originatorId: 'ONE_C', originId: COMPANY_GUID.toUpperCase(), assignedById: 5 } }
        if (params.id === 8) return { item: { id: 8, title: 'Без связи', originId: COMPANY_GUID } }
        if (params.id === 9) throw new Error('NOT_FOUND: Not found')
        throw new Error('503')
      }
      case 'crm.item.list': {
        const f = params.filter as { contactId: number }
        return { items: opts.ignoreFilter ? items : items.filter(i => i.contactId === f.contactId) }
      }
      case 'crm.item.update': {
        const it = items.find(i => i.id === params.id)!
        Object.assign(it, params.fields)
        return { item: it }
      }
      case 'crm.item.add': {
        const it = { id: 100 + items.length, ...(params.fields as object) } as Item
        items.push(it)
        return { item: it }
      }
      case 'crm.contact.company.items.get':
        return (opts.companies?.[params.id as number] ?? []).map(c => ({ COMPANY_ID: String(c) }))
      case 'crm.duplicate.findbycomm': return []
    }
    throw new Error(`unexpected ${method}`)
  }
  return { call, calls, items, setFailMeta: (v: boolean) => { failMeta = v } }
}

const item = (id: number, contactId: number, companyId: number, status = 'active'): Item =>
  ({ id, contactId, companyId, [F.keyHash]: `h${id}`, [F.status]: status, [F.expiresAt]: '' })

describe('createB24AccessDirectory', () => {
  it('неоднозначное поле не принимается', () => {
    expect(resolveFieldKey(['ufCrm3KeyHash', 'UF_CRM_3_KEY_HASH'], 'UF_CRM_3_KEY_HASH')).toBeNull()
    expect(resolveFieldKey(['ufCrm3KeyHash'], 'UF_CRM_3_KEY_HASH')).toBe('ufCrm3KeyHash')
  })

  it('если портал проигнорировал фильтр, чужие записи не возвращаются', async () => {
    const p = fakePortal([item(1, 5, 7), item(2, 6, 7)], { ignoreFilter: true })
    const recs = await createB24AccessDirectory(p.call).listAccessByContacts([5])
    expect(recs.map(r => r.id)).toEqual([1])
  })

  it('отзыв — только в указанной компании', async () => {
    const p = fakePortal([item(1, 5, 7), item(2, 5, 8)])
    expect(await createB24AccessDirectory(p.call).revokeAccess(5, 7)).toBe(1)
    expect(p.items.find(i => i.id === 1)![F.status]).toBe('revoked')
    expect(p.items.find(i => i.id === 2)![F.status]).toBe('active')
  })

  it('выдача обновляет запись своей компании, а не первую попавшуюся', async () => {
    const p = fakePortal([item(1, 5, 8), item(2, 5, 7)])
    const id = await createB24AccessDirectory(p.call).upsertAccess(5, 7, 'newhash', null)
    expect(id).toBe(2)
    expect(p.items.find(i => i.id === 1)![F.keyHash]).toBe('h1')
    expect(p.items.find(i => i.id === 2)![F.keyHash]).toBe('newhash')
  })

  it('выдача без записи создаёт новую с контактом и компанией', async () => {
    const p = fakePortal([])
    const id = await createB24AccessDirectory(p.call).upsertAccess(5, 7, 'hh', null)
    const add = p.calls.find(c => c.method === 'crm.item.add')!
    expect(add.params).toMatchObject({ entityTypeId: ETID, fields: { contactId: 5, companyId: 7, [F.keyHash]: 'hh', [F.status]: 'active' } })
    expect(id).toBe(100)
  })

  it('контакт в компании — только по ответу портала', async () => {
    const dir = createB24AccessDirectory(fakePortal([], { companies: { 5: [7] } }).call)
    expect(await dir.contactInCompany(5, 7)).toBe(true)
    expect(await dir.contactInCompany(5, 8)).toBe(false)
    expect(await dir.contactInCompany(6, 7)).toBe(false)
  })

  it('пустой ответ поиска контакта — пустой список', async () => {
    expect(await createB24AccessDirectory(fakePortal([]).call).findContactIds({ kind: 'PHONE', value: '375291234567' })).toEqual([])
  })

  it('ошибка загрузки метаданных не кэшируется', async () => {
    const p = fakePortal([item(1, 5, 7)])
    const dir = createB24AccessDirectory(p.call)
    p.setFailMeta(true)
    await expect(dir.listAccessByContacts([5])).rejects.toThrow('503')
    p.setFailMeta(false)
    expect((await dir.listAccessByContacts([5])).length).toBe(1)
  })
})

describe('getCompany: GUID 1С только из связи обмена', () => {
  it('ORIGINATOR_ID = ONE_C → GUID из ORIGIN_ID в нижнем регистре', async () => {
    const dir = createB24AccessDirectory(fakePortal([]).call)
    expect(await dir.getCompany(7)).toEqual({ id: 7, title: 'ООО Опт', onecGuid: COMPANY_GUID, assignedById: 5 })
  })
  it('без связи обмена — GUID нет', async () => {
    expect((await createB24AccessDirectory(fakePortal([]).call).getCompany(8))?.onecGuid).toBeNull()
  })
  it('нет компании — null, прочий сбой пробрасывается', async () => {
    const dir = createB24AccessDirectory(fakePortal([]).call)
    expect(await dir.getCompany(9)).toBeNull()
    await expect(dir.getCompany(10)).rejects.toThrow('503')
  })
})
