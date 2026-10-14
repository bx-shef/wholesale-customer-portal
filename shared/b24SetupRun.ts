/**
 * Прогон настройки коробки (docs/plan.md, этап 0): прочитать состояние портала, спланировать
 * недостающее (`planSetup`) и, если просили, записать. Транспорт — функция `call`: скрипт
 * `pnpm b24:setup` передаёт вебхук, сервер ЛК — токен установленного приложения.
 */
import { COMPANY_GUID_FIELD, planSetup, type PortalState } from './b24Setup'

export type SetupCall = (method: string, params: Record<string, unknown>) => Promise<unknown>

/** Списочные методы отдают по 50 строк; полная страница — значит, есть следующая. */
const PAGE = 50
const MAX_PAGES = 40

async function callAll<T>(call: SetupCall, method: string, params: Record<string, unknown>, pick: (result: unknown) => T[]): Promise<T[]> {
  const out: T[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = pick(await call(method, { ...params, start: page * PAGE }))
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export async function readPortalState(call: SetupCall): Promise<PortalState> {
  const companyFields = await callAll(call, 'crm.company.userfield.list', { filter: { FIELD_NAME: COMPANY_GUID_FIELD } }, r => (Array.isArray(r) ? r : []) as { FIELD_NAME: string }[])
  const types = await callAll(call, 'crm.type.list', {}, r => ((r as { types?: unknown[] })?.types ?? []) as { id: number, entityTypeId: number, title: string }[])
  const smartProcesses = []
  for (const type of types) {
    const fields = await callAll(call, 'userfieldconfig.list', { moduleId: 'crm', filter: { entityId: `CRM_${type.id}` } }, r => ((r as { fields?: unknown[] })?.fields ?? []) as { fieldName: string }[])
    smartProcesses.push({ id: Number(type.id), entityTypeId: Number(type.entityTypeId), title: type.title, fieldNames: fields.map(f => f.fieldName) })
  }
  const categories = await callAll(call, 'crm.category.list', { entityTypeId: 2 }, r => ((r as { categories?: unknown[] })?.categories ?? []) as { name: string }[])
  return {
    companyFieldNames: companyFields.map(f => f.FIELD_NAME),
    smartProcesses,
    dealCategoryNames: categories.map(c => c.name),
  }
}

export interface SetupReport {
  /** Что сделано (apply) или было бы сделано (план): `метод параметры`. */
  lines: string[]
  pending: string[]
  /** Портал настроен полностью. */
  done: boolean
}

/**
 * С записью — до трёх проходов: новый смарт-процесс получает поля только со следующего прохода
 * (`entityId` полей требует id типа, который портал выдаёт при создании).
 */
export async function runSetup(call: SetupCall, apply: boolean): Promise<SetupReport> {
  const lines: string[] = []
  for (let pass = 0; pass < (apply ? 3 : 1); pass++) {
    const { calls, pending } = planSetup(await readPortalState(call))
    if (calls.length === 0) return { lines, pending, done: pending.length === 0 }
    for (const c of calls) {
      lines.push(`${apply ? 'apply' : 'plan '} ${c.method} ${JSON.stringify(c.params)}`)
      if (apply) await call(c.method, c.params)
    }
    if (!apply) return { lines, pending, done: false }
  }
  const { calls, pending } = planSetup(await readPortalState(call))
  return { lines, pending, done: calls.length === 0 && pending.length === 0 }
}
