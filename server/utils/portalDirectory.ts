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

export interface SupplierAccount { account: string, bank: string, bik: string, currency: string }
export interface SupplierRequisites {
  name: string
  unp: string
  address: string
  accounts: SupplierAccount[]
}

/**
 * Только расчётные счета (2026-11-19, по данным портала): у «моей компании» среди банковских
 * реквизитов есть кредитные, их клиенту показывать нельзя. В белорусском IBAN символы 9–12 —
 * балансовый счёт: расчётный — `3012`, кредитные (`2120`, `2134`…) отбрасываются; плюс всё, где
 * в названии реквизита «кредит». Валюта — из скобок в названии («… (RUB)»), иначе `RQ_ACC_CURRENCY`.
 */
export function settlementAccounts(rows: Array<Record<string, unknown>>): SupplierAccount[] {
  const str = (v: unknown) => (v == null ? '' : String(v)).trim()
  const out: SupplierAccount[] = []
  for (const r of rows) {
    const account = str(r.RQ_ACC_NUM).replace(/\s+/g, '').toUpperCase()
    const name = str(r.NAME)
    if (account.slice(8, 12) !== '3012') continue
    if (/кредит/i.test(name)) continue
    const inName = name.match(/\(([A-Z]{3})\)/)
    out.push({ account, bank: str(r.RQ_BANK_NAME), bik: str(r.RQ_BIK), currency: inName?.[1] ?? str(r.RQ_ACC_CURRENCY) })
  }
  return out
}

/** Адрес реквизита строкой: юридический (TYPE_ID 6), при его отсутствии — фактический (1). */
export function requisiteAddress(rows: Array<Record<string, unknown>>): string {
  const pick = rows.find(r => String(r.TYPE_ID) === '6') ?? rows.find(r => String(r.TYPE_ID) === '1')
  if (!pick) return ''
  return ['POSTAL_CODE', 'PROVINCE', 'REGION', 'CITY', 'ADDRESS_1', 'ADDRESS_2']
    .map(k => (pick[k] == null ? '' : String(pick[k])).trim()).filter(Boolean).join(', ')
}

export async function loadCurrencyFormats(call: B24Call): Promise<PortalCurrencyFormats> {
  return parseCurrencyList(await call('crm.currency.list', {}))
}

/**
 * Реквизиты первой «моей компании»; нет компании — `null`. Подписанта не берём. Название — более
 * длинное из краткого и полного: на портале поставщика они перепутаны местами.
 */
export async function loadSupplierRequisites(call: B24Call): Promise<SupplierRequisites | null> {
  const mine = await call('crm.item.list', { entityTypeId: 4, filter: { isMyCompany: 'Y' }, select: ['id', 'title'] }) as { items?: Array<{ id: number, title?: string }> }
  const company = mine?.items?.[0]
  if (!company) return null
  const reqs = await call('crm.requisite.list', { filter: { ENTITY_TYPE_ID: 4, ENTITY_ID: company.id }, select: ['ID', 'RQ_COMPANY_NAME', 'RQ_COMPANY_FULL_NAME', 'RQ_INN'] }) as Array<Record<string, unknown>>
  const req = Array.isArray(reqs) ? reqs[0] : undefined
  const str = (v: unknown) => (v == null ? '' : String(v)).trim()
  const names = [str(req?.RQ_COMPANY_NAME), str(req?.RQ_COMPANY_FULL_NAME)].sort((a, b) => b.length - a.length)
  let accounts: SupplierAccount[] = []
  let address = ''
  if (req?.ID) {
    const details = await call('crm.requisite.bankdetail.list', { filter: { ENTITY_ID: req.ID }, select: ['NAME', 'RQ_ACC_NUM', 'RQ_BANK_NAME', 'RQ_BIK', 'RQ_ACC_CURRENCY'] })
    accounts = settlementAccounts(Array.isArray(details) ? details as Array<Record<string, unknown>> : [])
    // ENTITY_TYPE_ID 8 — реквизит. Адрес — не обязателен: сбой чтения адреса не прячет счета.
    try {
      const addrs = await call('crm.address.list', { filter: { ENTITY_TYPE_ID: 8, ENTITY_ID: req.ID } })
      address = requisiteAddress(Array.isArray(addrs) ? addrs as Array<Record<string, unknown>> : [])
    }
    catch { /* без адреса */ }
  }
  return { name: names[0] || str(company.title), unp: str(req?.RQ_INN), address, accounts }
}

const call = () => useB24Call()
export const portalCurrencies = cached(() => loadCurrencyFormats(call()), {} as PortalCurrencyFormats)
export const supplierRequisites = cached(() => loadSupplierRequisites(call()), null as SupplierRequisites | null)
