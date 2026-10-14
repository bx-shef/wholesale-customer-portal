/**
 * Вкладка «Личный кабинет» в карточке компании (docs/spec.md §3, этап 2): менеджер видит
 * контакты компании, выдаёт, перевыпускает и отзывает ключи. Чистое ядро: транспорт к порталу
 * и справочник доступа приходят зависимостями — тесты гоняют его без сети.
 *
 * Кто менеджер, решает ПОРТАЛ, а не мы: токеном фрейма от имени сотрудника читаем компанию
 * (`crm.company.get` — у него есть право её видеть) и пускаем, только если он ОТВЕТСТВЕННЫЙ за неё
 * или администратор портала (`user.admin`). Права на чтение мало: ключ открывает вход в ЛК от
 * имени клиента, и выдать его не должен стажёр-наблюдатель (находка ревью PR #11).
 * Контакты тоже читаются его токеном — вкладка не показывает больше, чем CRM показала бы ему.
 */
import { z } from 'zod'
import type { AccessDirectory, AccessRecord, B24Call } from '../services/b24Access'
import { ACCESS_STATUS } from '../services/b24Access'
import { issueAccessKey } from './accessAdmin'

export const tabRequestSchema = z.object({
  domain: z.string().min(1).max(253),
  authId: z.string().min(1).max(256),
  companyId: z.number().int().positive(),
  action: z.enum(['list', 'issue', 'revoke']),
  contactId: z.number().int().positive().optional(),
})
export type TabRequest = z.infer<typeof tabRequestSchema>

/** Вызов REST от имени сотрудника (токен фрейма). Сбой — исключение. */
export type UserCall = (domain: string, authId: string, method: string, params: Record<string, unknown>) => Promise<unknown>

export interface ContactInfo { id: number, name: string, phones: string[], emails: string[] }

export interface TabDeps {
  /** Хосты портала, чьим токенам верим: без списка любой Битрикс24 подсунул бы свой токен. */
  allowedHosts: string[]
  userCall: UserCall
  dir: AccessDirectory
  /** Контакты компании с телефонами и почтой — через переданный вызов (токен сотрудника). */
  listCompanyContacts: (companyId: number, call: B24Call) => Promise<ContactInfo[]>
  /** Сбросить кэш проверки ключа: отзыв и перевыпуск действуют сразу. */
  forgetAccess: (accessId?: number) => void
}

export interface TabContact extends ContactInfo {
  access: 'none' | 'active' | 'revoked' | 'expired'
  expiresAt: string | null
}

export type TabResult =
  | { status: 200, body: { contacts: TabContact[] } | { key: string, expiresAt: string | null } | { revoked: number } }
  | { status: 400 | 403 | 409, body: { error: string } }

/** Хост из домена фрейма: только имя и порт, без схемы, пути и учётных данных. */
export function normalizeHost(domain: string): string | null {
  // SDK фрейма отдаёт домен как origin (`https://crm.example.by`, auth.mjs → getTargetOrigin),
  // переменные окружения — голым хостом. Сводим к хосту; путь, учётные данные и прочее — отказ.
  const d = domain.trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/$/, '').replace(/:443$/, '')
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(d)) return null
  return d
}

/** Хосты, которым верим: B24_PORTAL_HOST, иначе портал, на котором установлено приложение. */
export function allowedHosts(explicit: string, installedDomain: string | null | undefined): string[] {
  const list = explicit.split(',').map(s => normalizeHost(s)).filter((h): h is string => !!h)
  if (list.length > 0) return list
  const host = normalizeHost(installedDomain ?? '')
  return host ? [host] : []
}

export function accessState(r: AccessRecord | undefined, now: Date): TabContact['access'] {
  if (!r) return 'none'
  if (r.status !== ACCESS_STATUS.active) return 'revoked'
  if (r.expiresAt && new Date(r.expiresAt).getTime() <= now.getTime()) return 'expired'
  return 'active'
}

const ERRORS = {
  contact_not_in_company: 'Контакт не привязан к этой компании',
  company_without_guid: 'У компании нет GUID 1С — она ещё не пришла из 1С',
  bad_ttl: 'Неверный срок действия',
} as const

export async function runTabAction(req: TabRequest, deps: TabDeps, now = new Date()): Promise<TabResult> {
  const host = normalizeHost(req.domain)
  if (!host || !deps.allowedHosts.includes(host)) return { status: 403, body: { error: 'Портал не подключён к ЛК' } }

  // Право сотрудника на эту компанию — ответом портала. Отказ, протухший токен, чужая компания
  // и сетевой сбой — один ответ: подробности наружу не нужны.
  const denied = { status: 403 as const, body: { error: 'Выдавать доступ может ответственный за компанию или администратор' } }
  const asUser: B24Call = (method, params) => deps.userCall(host, req.authId, method, params)
  try {
    const company = await asUser('crm.company.get', { id: req.companyId }) as { ID?: string | number, ASSIGNED_BY_ID?: string | number } | null
    if (!company || Number(company.ID) !== req.companyId) return denied
    const me = await asUser('user.current', {}) as { ID?: string | number } | null
    const myId = Number(me?.ID)
    if (!(myId > 0)) return denied
    if (Number(company.ASSIGNED_BY_ID) !== myId && (await asUser('user.admin', {})) !== true) return denied
  }
  catch {
    return denied
  }

  if (req.action === 'list') {
    const contacts = await deps.listCompanyContacts(req.companyId, asUser)
    const records = (await deps.dir.listAccessByContacts(contacts.map(c => c.id))).filter(r => r.companyId === req.companyId)
    return {
      status: 200,
      body: {
        contacts: contacts.map((c) => {
          // Записей на контакт в компании может быть несколько после ручных правок: берём действующую.
          const own = records.filter(r => r.contactId === c.id)
          const r = own.find(x => accessState(x, now) === 'active') ?? own[0]
          return { ...c, access: accessState(r, now), expiresAt: r?.expiresAt ?? null }
        }),
      },
    }
  }

  if (!req.contactId) return { status: 400, body: { error: 'Не выбран контакт' } }

  if (req.action === 'issue') {
    const result = await issueAccessKey(deps.dir, { contactId: req.contactId, companyId: req.companyId }, now)
    if (!result.ok) return { status: 409, body: { error: ERRORS[result.error] } }
    deps.forgetAccess(result.accessId)
    return { status: 200, body: { key: result.key, expiresAt: result.expiresAt } }
  }

  const revoked = await deps.dir.revokeAccess(req.contactId, req.companyId)
  deps.forgetAccess()
  return { status: 200, body: { revoked } }
}
