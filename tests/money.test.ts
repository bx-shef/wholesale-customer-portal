import { describe, expect, it } from 'vitest'
import { formatMoney } from '../app/utils/format'
import { SUPPLIER } from '../shared/supplier'

const NB = '\u00A0'

describe('суммы в ЛК (2026-11-19)', () => {
  it('BYN — «руб.» через неразрывный пробел, разряды и запятая ru-RU, 2 знака', () => {
    expect(formatMoney(524.16, 'BYN')).toBe(`524,16${NB}руб.`)
    expect(formatMoney(1234567.5, 'byn')).toBe(`1${NB}234${NB}567,50${NB}руб.`)
    expect(formatMoney(19.8, 'BYN')).toBe(`19,80${NB}руб.`)
  })
  it('другая валюта — кодом', () => {
    expect(formatMoney(19.82, 'USD')).toBe(`19,82${NB}USD`)
  })
})

describe('реквизиты поставщика', () => {
  it('только расчётные счета (3012 в IBAN)', () => {
    expect(SUPPLIER.accounts.map(a => a.account.slice(8, 12))).toEqual(['3012', '3012', '3012', '3012'])
    expect(SUPPLIER.unp).toBe('291184364')
  })
})
