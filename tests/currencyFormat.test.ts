import { describe, expect, it, vi } from 'vitest'
import { applyFormatString, formatAmountWithPortal, parseCurrencyList } from '../shared/currencyFormat'
import { cached, loadSupplierRequisites, requisiteAddress, settlementAccounts } from '../server/utils/portalDirectory'

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
  // Открытые реквизиты ООО «АльгенаЛайт» (портал поставщика, 2026-11-19) плюс кредитные счета.
  const details = [
    { NAME: 'Белагропромбанк', RQ_ACC_NUM: 'BY20BAPB30127244300100000000', RQ_BANK_NAME: 'Белагропромбанк ЦБУ №123', RQ_BIK: 'BAPBBY2X', RQ_ACC_CURRENCY: 'BYN' },
    { NAME: 'Белагропромбанк кредит', RQ_ACC_NUM: 'BY11BAPB21200000000000000000', RQ_BANK_NAME: 'Белагропромбанк', RQ_BIK: 'BAPBBY2X', RQ_ACC_CURRENCY: 'BYN' },
    { NAME: 'Белинвестбанк', RQ_ACC_NUM: 'BY63BLBB30120291184364001001', RQ_BANK_NAME: 'Белинвестбанк ЦБУ №404', RQ_BIK: 'BLBBBY2X', RQ_ACC_CURRENCY: 'BYN' },
    { NAME: 'Белинвестбанк', RQ_ACC_NUM: 'BY22BLBB21340291184364000000', RQ_BANK_NAME: 'Белинвестбанк', RQ_BIK: 'BLBBBY2X', RQ_ACC_CURRENCY: 'BYN' },
    { NAME: 'Беларусбанк', RQ_ACC_NUM: 'BY06AKBB30120666900101100000', RQ_BANK_NAME: 'Беларусбанк ЦБУ №106', RQ_BIK: 'AKBBBY2X', RQ_ACC_CURRENCY: 'BYN' },
    { NAME: 'Кредитная линия', RQ_ACC_NUM: 'BY33AKBB30120000000000000000', RQ_BANK_NAME: 'Беларусбанк', RQ_BIK: 'AKBBBY2X', RQ_ACC_CURRENCY: 'BYN' },
    { NAME: 'Белинвестбанк (RUB)', RQ_ACC_NUM: 'BY52BLBB30120291184364001005', RQ_BANK_NAME: 'Белинвестбанк', RQ_BIK: 'BLBBBY2X', RQ_ACC_CURRENCY: 'BYN' },
  ]
  it('только расчётные 3012, без кредитных и «кредит» в названии; валюта из скобок', () => {
    const r = settlementAccounts(details)
    expect(r.map(a => a.account)).toEqual(['BY20BAPB30127244300100000000', 'BY63BLBB30120291184364001001', 'BY06AKBB30120666900101100000', 'BY52BLBB30120291184364001005'])
    expect(r[3].currency).toBe('RUB')
    expect(r[0]).toEqual({ account: 'BY20BAPB30127244300100000000', bank: 'Белагропромбанк ЦБУ №123', bik: 'BAPBBY2X', currency: 'BYN' })
  })
  it('адрес: юридический, иначе фактический', () => {
    const fact = { TYPE_ID: '1', CITY: 'Брест', ADDRESS_1: 'ул. Факт' }
    expect(requisiteAddress([fact, { TYPE_ID: '6', POSTAL_CODE: '224000', CITY: 'Брест', ADDRESS_1: 'ул. Юр, 1' }, { TYPE_ID: '9', ADDRESS_1: 'склад' }])).toBe('224000, Брест, ул. Юр, 1')
    expect(requisiteAddress([fact])).toBe('Брест, ул. Факт')
    expect(requisiteAddress([])).toBe('')
  })
  it('название — более длинное, подписанта нет', async () => {
    const call = vi.fn(async (method: string) => ({
      'crm.item.list': { items: [{ id: 7, title: 'Компания' }] },
      'crm.requisite.list': [{ ID: '3', RQ_COMPANY_NAME: 'Общество с ограниченной ответственностью "АльгенаЛайт"', RQ_COMPANY_FULL_NAME: 'АльгенаЛайт', RQ_INN: '291184364', RQ_DIRECTOR: 'Липский А. С.' }],
      'crm.requisite.bankdetail.list': details,
      'crm.address.list': [],
    } as Record<string, unknown>)[method])
    const r = await loadSupplierRequisites(call)
    expect(r).toMatchObject({ name: 'Общество с ограниченной ответственностью "АльгенаЛайт"', unp: '291184364', address: '' })
    expect(r?.accounts).toHaveLength(4)
    expect(JSON.stringify(r)).not.toContain('Липский')
    expect(call.mock.calls[0][1]).toMatchObject({ entityTypeId: 4, filter: { isMyCompany: 'Y' } })
  })
  it('моей компании нет — null, реквизиты не запрашиваются', async () => {
    const call = vi.fn(async () => ({ items: [] }))
    expect(await loadSupplierRequisites(call)).toBeNull()
    expect(call).toHaveBeenCalledTimes(1)
  })
})
