import { describe, expect, it } from 'vitest'
import { companyOnecGuid } from '../shared/onecLink'

const G = '3fbebdf8-bd8b-11f1-b86f-00155d008d05'

describe('GUID 1С компании', () => {
  it('из связи штатного обмена 1С — как на коробке поставщика', () => {
    expect(companyOnecGuid({ originatorId: 'ONE_C', originId: G, ufCrm1cGuid: '' }, 'ufCrm1cGuid')).toBe(G)
    expect(companyOnecGuid({ originatorId: 'ONE_C', originId: G.toUpperCase() }, null)).toBe(G)
  })

  it('чужой источник связи не считается 1С; тогда — наше поле', () => {
    expect(companyOnecGuid({ originatorId: 'OTHER', originId: G }, 'ufCrm1cGuid')).toBeNull()
    expect(companyOnecGuid({ originatorId: 'OTHER', originId: G, ufCrm1cGuid: G }, 'ufCrm1cGuid')).toBe(G)
  })

  it('не GUID — нет связи', () => {
    expect(companyOnecGuid({ originatorId: 'ONE_C', originId: '123' }, null)).toBeNull()
    expect(companyOnecGuid({ ufCrm1cGuid: 'мусор' }, 'ufCrm1cGuid')).toBeNull()
    expect(companyOnecGuid({}, null)).toBeNull()
  })
})
