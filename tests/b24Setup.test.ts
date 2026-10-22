import { describe, expect, it } from 'vitest'
import { DEAL_CATEGORY_NAME, SMART_PROCESSES, planSetup, spFieldName, type PortalState } from '../shared/b24Setup'

const empty: PortalState = { smartProcesses: [], dealCategoryNames: [] }

function configured(): PortalState {
  return {
    smartProcesses: SMART_PROCESSES.map((sp, i) => ({
      id: 10 + i,
      entityTypeId: 1030 + i * 2,
      title: sp.title,
      fieldNames: sp.fields.map(f => spFieldName(10 + i, f.postfix)),
    })),
    dealCategoryNames: [DEAL_CATEGORY_NAME],
  }
}

describe('planSetup', () => {
  it('на пустом портале не трогает поля компании, создаёт смарт-процесс «Доступ в ЛК» и воронку', () => {
    const { calls, pending } = planSetup(empty)
    expect(calls.map(c => c.method)).toEqual(['crm.type.add', 'crm.category.add'])
    expect(pending).toHaveLength(1)
  })

  it('на настроенном портале план пуст — повторный запуск ничего не пишет', () => {
    expect(planSetup(configured())).toEqual({ calls: [], pending: [] })
  })

  it('досоздаёт только недостающее поле смарт-процесса', () => {
    const state = configured()
    state.smartProcesses[0]!.fieldNames.pop()
    const { calls } = planSetup(state)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'userfieldconfig.add', params: { field: { entityId: 'CRM_10', fieldName: 'UF_CRM_10_LAST_LOGIN' } } })
  })
})
