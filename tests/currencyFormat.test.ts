import { describe, expect, it, vi } from 'vitest'
import { applyFormatString, decodeEntities, formatAmountWithPortal, parseCurrencyList } from '../shared/currencyFormat'
import { formatMoney, meCurrencies } from '../app/utils/format'
import { cached, loadSupplierRequisites, meRoute, requisiteAddress, settlementAccounts, supplierRoute } from '../server/utils/portalDirectory'

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

describe('замечания ревью PR #164', () => {
  it('сущности: шестнадцатеричная, вне диапазона, суррогат, неизвестная, без двойного раскрытия', () => {
    expect(decodeEntities('&#x20BD;')).toBe('₽')
    expect(decodeEntities('&#99999999;')).toBe('&#99999999;')
    expect(decodeEntities('&#xD800;')).toBe('&#xD800;')
    expect(decodeEntities('&foo;')).toBe('&foo;')
    expect(decodeEntities('&amp;#8381;')).toBe('&#8381;')
  })
  it('битый шаблон портала не роняет страницу', () => {
    expect(formatAmountWithPortal(5, 'BYN', { BYN: { formatString: '# &#99999999;', decimals: 2 } })).toBe('5,00 &#99999999;')
    expect(formatAmountWithPortal(5, 'BYN', { BYN: { formatString: '#', decimals: 999 } })).toBe('5,00 руб.')
  })
  it('мусор в DECIMALS — два знака', () => {
    const f = parseCurrencyList([{ CURRENCY: 'BYN', FORMAT_STRING: '# руб.', DECIMALS: 'abc' }, { CURRENCY: 'USD', FORMAT_STRING: '$#', DECIMALS: '-1' }, { CURRENCY: 'EUR', FORMAT_STRING: '#', DECIMALS: '1.5' }])
    expect([f.BYN.decimals, f.USD.decimals, f.EUR.decimals]).toEqual([2, 2, 2])
  })
  it('formatMoney берёт справочник из payload «кто вошёл»', () => {
    expect(meCurrencies({ me: { currencies: { RUB: { formatString: '# &#8381;', decimals: 2 } } } })).toEqual({ RUB: { formatString: '# &#8381;', decimals: 2 } })
    expect(meCurrencies({ me: { currencies: [] } })).toBeUndefined()
    expect(meCurrencies(undefined)).toBeUndefined()
    expect(formatMoney(524.16, 'BYN')).toBe('524,16 руб.')
  })
  it('без сессии — 401 у «кто вошёл» и реквизитов, портал не трогается', async () => {
    const company = vi.fn()
    const load = vi.fn()
    expect(await meRoute(null, { company, stockMode: 'stock', currencies: () => ({}) })).toEqual({ status: 401 })
    expect(await supplierRoute(null, load)).toEqual({ status: 401 })
    expect(company).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
    const ok = await meRoute({ companyId: 5, contactId: 9 }, { company: async () => ({ id: 5, title: 'Ключ' }), stockMode: 'stock', currencies: () => formats })
    expect(ok).toEqual({ status: 200, body: { currencies: formats, stockMode: 'stock', contactId: 9, company: { id: 5, title: 'Ключ' } } })
    expect(await supplierRoute({}, async () => null)).toEqual({ status: 200, body: { supplier: null } })
  })
  it('кэш: после сбоя — прежнее хорошее значение; параллельные — одна загрузка; peek не ждёт', async () => {
    let t = 0
    const load = vi.fn().mockResolvedValueOnce('good').mockRejectedValueOnce(new Error('нет'))
    const get = cached(load, 'empty', () => t)
    expect(get.peek()).toBe('empty')
    expect(await Promise.all([get(), get(), get()])).toEqual(['good', 'good', 'good'])
    expect(load).toHaveBeenCalledTimes(1)
    t = 2 * 3_600_000
    expect(await get()).toBe('good')
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('синхронный бросок загрузки — сбой, а не исключение', async () => {
    const get = cached(() => { throw new Error('не подключён') }, 'empty')
    expect(await get()).toBe('empty')
  })
  it('несколько «моих компаний» — наименьший id', async () => {
    const call = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'crm.item.list') return { items: [{ id: 9, title: 'Б' }, { id: 3, title: 'А' }] }
      if (method === 'crm.requisite.list') return [{ ID: String((params.filter as { ENTITY_ID: number }).ENTITY_ID) }]
      return []
    })
    await loadSupplierRequisites(call)
    expect(call.mock.calls[1][1]).toMatchObject({ filter: { ENTITY_ID: 3 } })
  })
})
