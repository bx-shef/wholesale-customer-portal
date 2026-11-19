import { describe, expect, it, vi } from 'vitest'
import { applyFormatString, formatAmountWithPortal, parseCurrencyList } from '../shared/currencyFormat'
import { cached, loadSupplierRequisites } from '../server/utils/portalDirectory'

const NB = ' '
// Шаблоны, замеренные на живом портале (client-bank-alfa-by, 2026-09-16).
const formats = parseCurrencyList([
  { CURRENCY: 'BYN', FORMAT_STRING: '# руб.', DECIMALS: '2' },
  { CURRENCY: 'RUB', FORMAT_STRING: '# &#8381;', DECIMALS: '2' },
  { CURRENCY: 'USD', FORMAT_STRING: '$#', DECIMALS: '2' },
  { CURRENCY: 'EUR', FORMAT_STRING: '# &euro;', DECIMALS: '2' },
  { CURRENCY: '', FORMAT_STRING: '#' },
])

describe('суммы как у портала (2026-11-19)', () => {
  it('шаблоны портала: подпись справа, слева, сущности', () => {
    expect(formatAmountWithPortal(1524.16, 'BYN', formats)).toBe(`1${NB}524,16 руб.`)
    expect(formatAmountWithPortal(29, 'RUB', formats)).toBe('29,00 ₽')
    expect(formatAmountWithPortal(19.82, 'USD', formats)).toBe('$19,82')
    expect(formatAmountWithPortal(5, 'EUR', formats)).toBe('5,00 €')
  })
  it('решётка в сущности не заменяется числом', () => {
    expect(applyFormatString('# &#8381;', '1')).toBe('1 ₽')
  })
  it('запасной вид: BYN — «руб.», прочие — кодом', () => {
    expect(formatAmountWithPortal(524.16, 'BYN')).toBe('524,16 руб.')
    expect(formatAmountWithPortal(19.82, 'USD', {})).toBe('19,82 USD')
  })
  it('строки без кода в справочник не попадают', () => {
    expect(Object.keys(formats)).toEqual(['BYN', 'RUB', 'USD', 'EUR'])
  })
})

describe('кэш справочников портала', () => {
  it('успех держится час, сбой — пустое значение и повтор через 5 минут', async () => {
    let t = 0
    const load = vi.fn().mockRejectedValueOnce(new Error('нет')).mockResolvedValue('ok')
    const get = cached(load, 'empty', () => t)
    expect(await get()).toBe('empty')
    t = 60_000
    expect(await get()).toBe('empty')
    t = 5 * 60_000 + 1
    expect(await get()).toBe('ok')
    t += 59 * 60_000
    expect(await get()).toBe('ok')
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('реквизиты поставщика', () => {
  it('три вызова: моя компания → реквизит → банк', async () => {
    const call = vi.fn(async (method: string) => ({
      'crm.item.list': { items: [{ id: 7, title: 'Компания' }] },
      'crm.requisite.list': [{ ID: '3', RQ_COMPANY_NAME: 'ООО «Поставщик»', RQ_INN: '191234567' }],
      'crm.requisite.bankdetail.list': [{ RQ_ACC_NUM: 'BY00ALFA3012', RQ_BANK_NAME: 'Альфа-Банк', RQ_BIK: 'ALFABY2X' }],
    } as Record<string, unknown>)[method])
    expect(await loadSupplierRequisites(call)).toEqual({ name: 'ООО «Поставщик»', unp: '191234567', account: 'BY00ALFA3012', bank: 'Альфа-Банк', bik: 'ALFABY2X' })
    expect(call.mock.calls[0][1]).toMatchObject({ entityTypeId: 4, filter: { isMyCompany: 'Y' } })
  })
  it('моей компании нет — null, реквизиты не запрашиваются', async () => {
    const call = vi.fn(async () => ({ items: [] }))
    expect(await loadSupplierRequisites(call)).toBeNull()
    expect(call).toHaveBeenCalledTimes(1)
  })
})
