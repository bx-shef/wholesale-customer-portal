import { describe, expect, it } from 'vitest'
import { companyOnecGuid } from '../shared/onecLink'

const G = '3fbebdf8-bd8b-11f1-b86f-00155d008d05'

describe('companyOnecGuid', () => {
  it('берёт GUID из связи обмена 1С, в нижнем регистре', () => {
    expect(companyOnecGuid({ originatorId: 'ONE_C', originId: G })).toBe(G)
    expect(companyOnecGuid({ originatorId: 'ONE_C', originId: G.toUpperCase() })).toBe(G)
  })

  it('чужой источник и своё поле GUID не принимаются (поля UF_CRM_1C_GUID больше нет)', () => {
    expect(companyOnecGuid({ originatorId: 'OTHER', originId: G })).toBeNull()
    expect(companyOnecGuid({ originatorId: 'OTHER', originId: G, ufCrm1cGuid: G })).toBeNull()
  })

  it('не GUID — null', () => {
    expect(companyOnecGuid({ originatorId: 'ONE_C', originId: '123' })).toBeNull()
    expect(companyOnecGuid({})).toBeNull()
    expect(companyOnecGuid({ originId: G })).toBeNull()
    expect(companyOnecGuid({ originatorId: 'one_c', originId: G })).toBeNull()
    expect(companyOnecGuid({ originatorId: 'ONE_C', originId: ` ${G} ` })).toBe(G)
  })
})
