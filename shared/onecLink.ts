/**
 * Связь компании CRM с клиентом 1С. Штатный обмен 1С ↔ Битрикс24 кладёт GUID клиента в
 * стандартные поля связи: `ORIGINATOR_ID = ONE_C`, `ORIGIN_ID = <GUID>` (замерено на коробке
 * поставщика 14.10.2026: компании из 1С так и приходят, наше `UF_CRM_1C_GUID` у них пустое).
 * Поэтому GUID ищем сначала там, а своё поле — запасной путь для компаний, заведённых ЛК.
 */
export const ONEC_ORIGINATOR = 'ONE_C'

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** GUID 1С компании из ответа `crm.item.*` (camelCase): связь обмена 1С, иначе наше поле. */
export function companyOnecGuid(item: Record<string, unknown>, ufKey: string | null): string | null {
  const origin = String(item.originId ?? '').trim()
  if (String(item.originatorId ?? '') === ONEC_ORIGINATOR && GUID_RE.test(origin)) return origin.toLowerCase()
  const uf = ufKey ? String(item[ufKey] ?? '').trim() : ''
  return GUID_RE.test(uf) ? uf.toLowerCase() : null
}
