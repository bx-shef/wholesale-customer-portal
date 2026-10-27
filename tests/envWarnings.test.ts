import { describe, expect, it } from 'vitest'
import { envWarnings } from '../server/utils/envWarnings'

describe('envWarnings', () => {
  it('ловит комментарий в строке, кавычки, \\r, кривые флаги, режим, адрес и частоты — без значений', () => {
    const w = envWarnings({
      ONEC_URL: 'https://1c.example/odata # тестовая',
      ONEC_PASSWORD: '"секрет"',
      SESSION_SECRET: 'abc\r',
      ONEC_ODATA_IMAGES: 'yes',
      ONEC_MODE: 'OData2',
      PUBLIC_URL: 'wsp.algena.by',
      SYNC_PRICES_EVERY_MIN: '120 # раз в 2 часа',
      PATH: 'a # b',
    })
    expect(w.some(x => x.startsWith('ONEC_URL:') && x.includes('комментарий'))).toBe(true)
    expect(w.some(x => x.startsWith('ONEC_PASSWORD:') && x.includes('кавычках'))).toBe(true)
    expect(w.some(x => x.startsWith('SESSION_SECRET:') && x.includes('\\r'))).toBe(true)
    expect(w).toContain('ONEC_ODATA_IMAGES: ожидается true или false')
    expect(w.some(x => x.startsWith('ONEC_MODE:'))).toBe(true)
    expect(w.some(x => x.startsWith('PUBLIC_URL:'))).toBe(true)
    expect(w.some(x => x.startsWith('SYNC_PRICES_EVERY_MIN:') && x.includes('целое'))).toBe(true)
    // Чужие переменные не трогаем, значения в текст не попадают.
    expect(w.some(x => x.startsWith('PATH'))).toBe(false)
    expect(w.join(' ')).not.toContain('секрет')
  })
  it('правильные значения — без предупреждений', () => {
    expect(envWarnings({ ONEC_URL: 'https://1c.example/odata', ONEC_MODE: 'odata', ONEC_MOCK: 'false', ONEC_ODATA_IMAGES: 'true', SYNC_STOCK_EVERY_MIN: '15', ONEC_PRICE_TYPES: 'Опт Розница,Продажа' })).toEqual([])
  })
})
