/**
 * Справочники портала для экранов ЛК (2026-11-19): форматы валют (`crm.currency.list`) и реквизиты
 * поставщика — «моя компания» (`crm.item.list` isMyCompany → `crm.requisite.list` →
 * `crm.requisite.bankdetail.list`, обход как в client-bank-alfa-by myCompanyRequisites.ts).
 * Токеном приложения, кэш в памяти на час; портал не ответил — пусто (валюта запасным видом, блока
 * реквизитов нет), повтор не раньше чем через 5 минут.
 */
import type { B24Call } from '../services/b24Access'
import { parseCurrencyList, type PortalCurrencyFormats } from '../../shared/currencyFormat'

const HOUR = 3_600_000
const RETRY = 5 * 60_000

export interface SupplierRequisites {
  name: string
  unp: string
  account: string
  bank: string
  bik: string
}

/** Кэш с разным сроком для успеха и сбоя: сбой портала не должен дёргать его на каждой странице. */
export function cached<T>(load: () => Promise<T>, empty: T, now: () => number = Date.now) {
  let entry: { value: T, until: number } | undefined
  return async (): Promise<T> => {
    if (entry && entry.until > now()) return entry.value
    try {
      entry = { value: await load(), until: now() + HOUR }
    }
    catch {
      entry = { value: empty, until: now() + RETRY }
    }
    return entry.value
  }
}

export async function loadCurrencyFormats(call: B24Call): Promise<PortalCurrencyFormats> {
  return parseCurrencyList(await call('crm.currency.list', {}))
}

/** Реквизиты первой «моей компании»; нет компании — `null`. */
export async function loadSupplierRequisites(call: B24Call): Promise<SupplierRequisites | null> {
  const mine = await call('crm.item.list', { entityTypeId: 4, filter: { isMyCompany: 'Y' }, select: ['id', 'title'] }) as { items?: Array<{ id: number, title?: string }> }
  const company = mine?.items?.[0]
  if (!company) return null
  const reqs = await call('crm.requisite.list', { filter: { ENTITY_TYPE_ID: 4, ENTITY_ID: company.id }, select: ['ID', 'RQ_COMPANY_NAME', 'RQ_INN'] }) as Array<Record<string, unknown>>
  const req = Array.isArray(reqs) ? reqs[0] : undefined
  const str = (v: unknown) => (v == null ? '' : String(v)).trim()
  let bank: Record<string, unknown> | undefined
  if (req?.ID) {
    const details = await call('crm.requisite.bankdetail.list', { filter: { ENTITY_ID: req.ID }, select: ['RQ_ACC_NUM', 'RQ_BANK_NAME', 'RQ_BIK'] }) as Array<Record<string, unknown>>
    bank = Array.isArray(details) ? details[0] : undefined
  }
  return {
    name: str(req?.RQ_COMPANY_NAME) || str(company.title),
    unp: str(req?.RQ_INN),
    account: str(bank?.RQ_ACC_NUM),
    bank: str(bank?.RQ_BANK_NAME),
    bik: str(bank?.RQ_BIK),
  }
}

const call = () => useB24Call()
export const portalCurrencies = cached(() => loadCurrencyFormats(call()), {} as PortalCurrencyFormats)
export const supplierRequisites = cached(() => loadSupplierRequisites(call()), null as SupplierRequisites | null)
