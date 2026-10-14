import { describe, expect, it } from 'vitest'
import { frameAncestorsPolicy } from '../server/utils/frameAncestors'

describe('кто может встроить ЛК во фрейм', () => {
  it('страницы приложения — только портал коробки', () => {
    expect(frameAncestorsPolicy('/b24/app', 'crm.algena.by')).toBe('frame-ancestors https://crm.algena.by')
    expect(frameAncestorsPolicy('/b24/company-tab?DOMAIN=x', ' CRM.algena.by ')).toBe('frame-ancestors https://crm.algena.by')
  })

  it('остальной ЛК и /b24/ без настроенного портала — никому', () => {
    expect(frameAncestorsPolicy('/login', 'crm.algena.by')).toBe("frame-ancestors 'none'")
    expect(frameAncestorsPolicy('/b24x', 'crm.algena.by')).toBe("frame-ancestors 'none'")
    expect(frameAncestorsPolicy('/b24/app', '')).toBe("frame-ancestors 'none'")
    expect(frameAncestorsPolicy('/b24/app', 'https://evil.by/x')).toBe("frame-ancestors 'none'")
  })
})
