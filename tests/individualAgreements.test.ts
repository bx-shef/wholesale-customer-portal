import { describe, expect, it, vi } from 'vitest'
import { isIndividualAgreement, readAgreements } from '../server/services/onecOdataClients'

const EMPTY = '00000000-0000-0000-0000-000000000000'

describe('только индивидуальные соглашения', () => {
  it('пустое типовое — индивидуальное, заполненное — нет, поля нет — не фильтруем', () => {
    expect(isIndividualAgreement({ Ref_Key: 'a', ТиповоеСоглашение_Key: EMPTY })).toBe(true)
    expect(isIndividualAgreement({ Ref_Key: 'a', ТиповоеСоглашение_Key: '' })).toBe(true)
    expect(isIndividualAgreement({ Ref_Key: 'a', ТиповоеСоглашение_Key: '11111111-1111-1111-1111-111111111111' })).toBe(false)
    expect(isIndividualAgreement({ Ref_Key: 'a' })).toBe(true)
  })

  it('поле просим; отказ OData — читаем без него и пишем в журнал', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const read = vi.fn(async (f: string) => {
      if (f.includes('ТиповоеСоглашение_Key')) throw new Error('400')
      return [{ Ref_Key: 'x' }]
    })
    expect(await readAgreements(read)).toEqual([{ Ref_Key: 'x' }])
    expect(read).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('с полем — один запрос; сбой и без поля — исходная ошибка', async () => {
    const ok = vi.fn(async () => [{ Ref_Key: 'x', ТиповоеСоглашение_Key: EMPTY }])
    await readAgreements(ok)
    expect(ok).toHaveBeenCalledTimes(1)
    expect(ok.mock.calls[0]![0]).toContain('ТиповоеСоглашение_Key')
    const first = new Error('first')
    let n = 0
    await expect(readAgreements(async () => { throw n++ ? new Error('second') : first })).rejects.toBe(first)
  })
})
