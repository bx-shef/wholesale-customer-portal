/**
 * Связь компании CRM с клиентом 1С. Компании заводит и правит только штатный обмен 1С ↔ Битрикс24
 * (решение владельца 2026-10-22): он кладёт GUID клиента в стандартные поля связи
 * `ORIGINATOR_ID = ONE_C`, `ORIGIN_ID = <GUID>` (замерено на коробке 14.10.2026, механизм обмена
 * подтверждён программистом 1С 22.10.2026). Своего поля GUID у ЛК больше нет.
 */
export const ONEC_ORIGINATOR = 'ONE_C'

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** GUID 1С компании из ответа `crm.item.*` (camelCase): только связь обмена 1С. */
export function companyOnecGuid(item: Record<string, unknown>): string | null {
  const origin = String(item.originId ?? '').trim()
  return String(item.originatorId ?? '') === ONEC_ORIGINATOR && GUID_RE.test(origin) ? origin.toLowerCase() : null
}
