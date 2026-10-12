/**
 * Что нужно ЛК в CRM коробки (docs/spec.md §3–4, docs/plan.md этап 0) и что из этого ещё не
 * создано. Чистые функции: скрипт `scripts/b24-setup.ts` читает портал, отдаёт сюда, получает
 * список вызовов. Повторный запуск на настроенном портале даёт пустой план — идемпотентность
 * держится на сверке по коду поля и названию, а не на памяти скрипта.
 *
 * Встройку `CRM_COMPANY_DETAIL_TAB` и `event.bind` здесь НЕ регистрируем: оба метода требуют
 * контекста приложения (`placement.bind` → `WRONG_AUTH_TYPE … Application context required`
 * по документации), а скрипт ходит вебхуком. Их делает установка приложения (этап 2).
 */

export interface RestCall {
  method: string
  params: Record<string, unknown>
}

/** Поле смарт-процесса без префикса: полный код `UF_CRM_<id типа>_<postfix>`. */
export interface SpFieldSpec {
  postfix: string
  userTypeId: 'string' | 'datetime' | 'date' | 'integer'
  label: string
}

export interface SmartProcessSpec {
  title: string
  /** Клиент (компания и контакт) — у «Доступа в ЛК» он и есть владелец ключа. */
  isClientEnabled: boolean
  fields: SpFieldSpec[]
}

export const COMPANY_GUID_FIELD = 'UF_CRM_1C_GUID'
export const DEAL_CATEGORY_NAME = 'Заявки ЛК'

export const SMART_PROCESSES: SmartProcessSpec[] = [
  {
    title: 'Доступ в ЛК',
    isClientEnabled: true,
    fields: [
      // Хэш, а не сам ключ: ключ показывается менеджеру один раз (docs/spec.md §3).
      { postfix: 'KEY_HASH', userTypeId: 'string', label: 'Хэш ключа' },
      { postfix: 'STATUS', userTypeId: 'string', label: 'Статус доступа' },
      { postfix: 'EXPIRES_AT', userTypeId: 'datetime', label: 'Действует до' },
      { postfix: 'LAST_LOGIN', userTypeId: 'datetime', label: 'Последний вход' },
    ],
  },
  {
    title: 'Рейсы',
    isClientEnabled: false,
    fields: [
      // Расписание по docs/spec.md §8 (разбор — shared/delivery.ts): одна запись — один город.
      { postfix: 'CITY', userTypeId: 'string', label: 'Город' },
      { postfix: 'WEEKDAYS', userTypeId: 'string', label: 'Дни недели (пн, ср, пт)' },
      { postfix: 'CUTOFF_TIME', userTypeId: 'string', label: 'Приём заявок до (16:00)' },
      { postfix: 'CUTOFF_DAYS', userTypeId: 'integer', label: 'Отсечка за дней до рейса' },
      { postfix: 'ARRIVAL_FROM', userTypeId: 'string', label: 'Прибытие с (10:00)' },
      { postfix: 'ARRIVAL_TO', userTypeId: 'string', label: 'Прибытие до (14:00)' },
      { postfix: 'EXCEPTIONS', userTypeId: 'string', label: 'Без рейса (даты через запятую)' },
    ],
  },
]

/** Что прочитано с портала. */
export interface PortalState {
  companyFieldNames: string[]
  /** Смарт-процессы по названию: `id` — внутренний id типа (он в `entityId` полей, `CRM_<id>`). */
  smartProcesses: { id: number, entityTypeId: number, title: string, fieldNames: string[] }[]
  dealCategoryNames: string[]
}

export function spFieldName(typeId: number, postfix: string): string {
  return `UF_CRM_${typeId}_${postfix}`
}

/** Вызовы, создающие недостающее. Смарт-процесс, которого ещё нет, получает поля вторым прогоном. */
export function planSetup(state: PortalState): { calls: RestCall[], pending: string[] } {
  const calls: RestCall[] = []
  const pending: string[] = []

  if (!state.companyFieldNames.includes(COMPANY_GUID_FIELD)) {
    calls.push({
      method: 'crm.company.userfield.add',
      params: {
        // FIELD_NAME — без префикса: портал добавляет UF_CRM_ сам (документация метода).
        fields: { FIELD_NAME: COMPANY_GUID_FIELD.replace(/^UF_CRM_/, ''), USER_TYPE_ID: 'string', LABEL: 'GUID 1С', XML_ID: COMPANY_GUID_FIELD },
      },
    })
  }

  for (const spec of SMART_PROCESSES) {
    const existing = state.smartProcesses.find(sp => sp.title === spec.title)
    if (!existing) {
      calls.push({
        method: 'crm.type.add',
        params: { fields: { title: spec.title, isClientEnabled: spec.isClientEnabled ? 'Y' : 'N', isStagesEnabled: 'N', isCategoriesEnabled: 'N' } },
      })
      pending.push(`поля «${spec.title}» — после создания смарт-процесса, повторным запуском`)
      continue
    }
    for (const field of spec.fields) {
      const name = spFieldName(existing.id, field.postfix)
      if (existing.fieldNames.includes(name)) continue
      calls.push({
        method: 'userfieldconfig.add',
        params: {
          moduleId: 'crm',
          field: { entityId: `CRM_${existing.id}`, fieldName: name, userTypeId: field.userTypeId, editFormLabel: field.label },
        },
      })
    }
  }

  if (!state.dealCategoryNames.includes(DEAL_CATEGORY_NAME)) {
    calls.push({ method: 'crm.category.add', params: { entityTypeId: 2, fields: { name: DEAL_CATEGORY_NAME } } })
  }

  return { calls, pending }
}
