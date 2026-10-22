/**
 * Доступ в ЛК поверх CRM коробки (docs/spec.md §3): контакт по телефону/email, элемент
 * смарт-процесса «Доступ в ЛК» с хэшем ключа, компания с GUID 1С (из связи обмена `ORIGINATOR_ID`/`ORIGIN_ID`). Транспорт — функция
 * `call(method, params)`: в приложении это B24Hook по вебхуку, в тестах — подделка.
 *
 * Имена пользовательских полей `crm.item.*` отдаёт в camelCase (`ufCrm…`), а точное правило
 * преобразования документация не описывает. Поэтому ключи полей не угадываем, а находим в
 * `crm.item.fields` по исходному коду поля (`UF_CRM_<id>_KEY_HASH`) — и падаем понятно, если
 * поля нет (не прогнан `pnpm b24:setup`).
 */
import type { NormalizedLogin } from '../../shared/access/login'
import { SMART_PROCESSES, spFieldName } from '../../shared/b24Setup'
import { companyOnecGuid } from '../../shared/onecLink'

export type B24Call = (method: string, params: Record<string, unknown>) => Promise<unknown>

export interface AccessRecord {
  id: number
  contactId: number
  companyId: number
  keyHash: string
  status: string
  expiresAt: string | null
}

export interface CompanyInfo {
  id: number
  title: string
  onecGuid: string | null
  /** Ответственный за компанию — менеджер клиента в профиле ЛК. */
  assignedById: number | null
}

export interface AccessDirectory {
  findContactIds(login: NormalizedLogin): Promise<number[]>
  listAccessByContacts(contactIds: number[]): Promise<AccessRecord[]>
  getAccess(id: number): Promise<AccessRecord | null>
  getCompany(id: number): Promise<CompanyInfo | null>
  markLogin(accessId: number, at: Date): Promise<void>
  /** Выдать ключ: создать или обновить запись контакта в компании. Возвращает id записи. */
  upsertAccess(contactId: number, companyId: number, keyHash: string, expiresAt: Date | null): Promise<number>
  revokeAccess(contactId: number, companyId: number): Promise<number>
  /** Контакт действительно привязан к компании — ключ не выдать «чужому» контакту. */
  contactInCompany(contactId: number, companyId: number): Promise<boolean>
}

/**
 * «Записи нет» — только ответ портала NOT_FOUND. Любой другой сбой (сеть, 5xx, лимит) —
 * исключение: иначе простой CRM выглядел бы как отозванный ключ и разлогинивал всех.
 */
export function isNotFound(e: unknown): boolean {
  return /not.?found|не найден/i.test((e as Error)?.message ?? '')
}

export const ACCESS_STATUS = { active: 'active', revoked: 'revoked' } as const
const ACCESS_TITLE = SMART_PROCESSES.find(sp => sp.title === 'Доступ в ЛК')!.title
const MAX_RECORDS = 20

/** Ключ поля в crm.item.* по исходному коду: сравнение без регистра и подчёркиваний. */
export function resolveFieldKey(keys: string[], original: string): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/_/g, '')
  const found = keys.filter(k => norm(k) === norm(original))
  return found.length === 1 ? found[0]! : null
}

interface AccessMeta {
  entityTypeId: number
  fields: { keyHash: string, status: string, expiresAt: string, lastLogin: string }
}

export function createB24AccessDirectory(call: B24Call): AccessDirectory {
  let meta: Promise<AccessMeta> | undefined

  const loadMeta = async (): Promise<AccessMeta> => {
    const { types } = await call('crm.type.list', { filter: { title: ACCESS_TITLE } }) as { types: { id: number, entityTypeId: number, title: string }[] }
    const type = types.find(t => t.title === ACCESS_TITLE)
    if (!type) throw new Error(`Smart process «${ACCESS_TITLE}» not found — run pnpm b24:setup`)
    const { fields } = await call('crm.item.fields', { entityTypeId: type.entityTypeId }) as { fields: Record<string, unknown> }
    const keys = Object.keys(fields)
    const pick = (postfix: string) => {
      const key = resolveFieldKey(keys, spFieldName(Number(type.id), postfix))
      if (!key) throw new Error(`Field ${spFieldName(Number(type.id), postfix)} not found — run pnpm b24:setup`)
      return key
    }
    return {
      entityTypeId: Number(type.entityTypeId),
      fields: { keyHash: pick('KEY_HASH'), status: pick('STATUS'), expiresAt: pick('EXPIRES_AT'), lastLogin: pick('LAST_LOGIN') },
    }
  }
  // Ошибка не кэшируется: после pnpm b24:setup следующий вызов найдёт поля.
  const getMeta = () => (meta ??= loadMeta().catch((e) => {
    meta = undefined
    throw e
  }))

  const toRecord = (m: AccessMeta, item: Record<string, unknown>): AccessRecord => ({
    id: Number(item.id),
    contactId: Number(item.contactId),
    companyId: Number(item.companyId),
    keyHash: String(item[m.fields.keyHash] ?? ''),
    status: String(item[m.fields.status] ?? ''),
    expiresAt: item[m.fields.expiresAt] ? String(item[m.fields.expiresAt]) : null,
  })
  const select = (m: AccessMeta) => ['id', 'contactId', 'companyId', ...Object.values(m.fields)]

  return {
    async findContactIds(login) {
      // Телефон — в обеих записях: как CRM хранит «+», документация метода не уточняет.
      const values = login.kind === 'PHONE' ? [login.value, `+${login.value}`] : [login.value]
      const result = await call('crm.duplicate.findbycomm', { entity_type: 'CONTACT', type: login.kind, values }) as { CONTACT?: number[] } | []
      // Пустой результат REST отдаёт пустым массивом, а не объектом.
      return Array.isArray(result) ? [] : (result.CONTACT ?? []).map(Number).slice(0, MAX_RECORDS)
    },

    async listAccessByContacts(contactIds) {
      if (contactIds.length === 0) return []
      const m = await getMeta()
      const out: AccessRecord[] = []
      // По одному контакту: оператор «в списке» для crm.item.list документация не описывает,
      // а контактов на один логин — единицы.
      for (const contactId of contactIds.slice(0, MAX_RECORDS)) {
        const { items } = await call('crm.item.list', { entityTypeId: m.entityTypeId, filter: { contactId }, select: select(m) }) as { items: Record<string, unknown>[] }
        // Непонятый фильтр REST игнорирует и отдаёт всё (навык b24-docs): перепроверяем сами.
        out.push(...items.map(i => toRecord(m, i)).filter(r => r.contactId === contactId))
      }
      return out.slice(0, MAX_RECORDS)
    },

    async getAccess(id) {
      const m = await getMeta()
      try {
        const { item } = await call('crm.item.get', { entityTypeId: m.entityTypeId, id }) as { item: Record<string, unknown> }
        return item ? toRecord(m, item) : null
      }
      catch (e) {
        if (isNotFound(e)) return null
        throw e
      }
    },

    async getCompany(id) {
      try {
        const { item } = await call('crm.item.get', { entityTypeId: 4, id }) as { item: Record<string, unknown> }
        if (!item) return null
        return { id: Number(item.id), title: String(item.title ?? ''), onecGuid: companyOnecGuid(item), assignedById: Number(item.assignedById) > 0 ? Number(item.assignedById) : null }
      }
      catch (e) {
        if (isNotFound(e)) return null
        throw e
      }
    },

    async markLogin(accessId, at) {
      const m = await getMeta()
      await call('crm.item.update', { entityTypeId: m.entityTypeId, id: accessId, fields: { [m.fields.lastLogin]: at.toISOString() } })
    },

    async upsertAccess(contactId, companyId, keyHash, expiresAt) {
      const m = await getMeta()
      const fields = {
        [m.fields.keyHash]: keyHash,
        [m.fields.status]: ACCESS_STATUS.active,
        [m.fields.expiresAt]: expiresAt ? expiresAt.toISOString() : '',
      }
      const existing = (await this.listAccessByContacts([contactId])).find(r => r.companyId === companyId)
      if (existing) {
        await call('crm.item.update', { entityTypeId: m.entityTypeId, id: existing.id, fields })
        return existing.id
      }
      const { item } = await call('crm.item.add', {
        entityTypeId: m.entityTypeId,
        fields: { title: `Доступ в ЛК: контакт ${contactId}`, contactId, companyId, ...fields },
      }) as { item: { id: number } }
      return Number(item.id)
    },

    async revokeAccess(contactId, companyId) {
      const m = await getMeta()
      const records = (await this.listAccessByContacts([contactId])).filter(r => r.companyId === companyId && r.status !== ACCESS_STATUS.revoked)
      for (const r of records) {
        await call('crm.item.update', { entityTypeId: m.entityTypeId, id: r.id, fields: { [m.fields.status]: ACCESS_STATUS.revoked } })
      }
      return records.length
    },

    async contactInCompany(contactId, companyId) {
      const result = await call('crm.contact.company.items.get', { id: contactId }) as { COMPANY_ID: number | string }[]
      return Array.isArray(result) && result.some(r => Number(r.COMPANY_ID) === companyId)
    },
  }
}

const MAX_COMPANY_CONTACTS = 50

/**
 * Контакты компании для вкладки менеджера: привязки (`crm.company.contact.items.get`), затем
 * каждый контакт (`crm.contact.get`) — имя, телефоны, почта. Не больше 50: у оптового клиента их
 * единицы, а вкладка не должна тратить лимит REST на компанию-справочник.
 */
export async function listCompanyContacts(call: B24Call, companyId: number) {
  const links = await call('crm.company.contact.items.get', { id: companyId }) as { CONTACT_ID: number | string }[]
  const ids = [...new Set((Array.isArray(links) ? links : []).map(l => Number(l.CONTACT_ID)).filter(id => id > 0))].slice(0, MAX_COMPANY_CONTACTS)
  const out = []
  for (const id of ids) {
    const c = await call('crm.contact.get', { id }) as Record<string, unknown> | null
    if (!c) continue
    const values = (v: unknown) => (Array.isArray(v) ? v : []).map(x => String((x as { VALUE?: unknown }).VALUE ?? '').trim()).filter(Boolean)
    const name = [c.LAST_NAME, c.NAME, c.SECOND_NAME].map(x => String(x ?? '').trim()).filter(Boolean).join(' ')
    out.push({ id, name: name || `Контакт ${id}`, phones: values(c.PHONE), emails: values(c.EMAIL) })
  }
  return out
}
