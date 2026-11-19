import { describe, expect, it } from 'vitest'
import { parseScheduleEnv } from '../shared/delivery'
import { calendarCities } from '../server/utils/deliveryCities'

const { schedules } = parseScheduleEnv('Вт: Иваново; Ср: Брест')

describe('города клиента для «Доставки» (2026-11-18)', () => {
  it('город из текста адреса, если колонка пустая', () => {
    const r = calendarCities(schedules, [{ city: '', address: '225793, Брестская обл., г. Иваново, ул. Карла Маркса, д. 51а' }], null)
    expect(r).toMatchObject({ cities: ['Иваново'], noCity: [] })
  })
  it('колонка «Город» главнее текста', () => {
    expect(calendarCities(schedules, [{ city: 'Брест', address: 'г. Иваново' }], null).cities).toEqual(['Брест'])
  })
  it('ни в адресе, ни в колонке — зона доставки клиента', () => {
    expect(calendarCities(schedules, [{ city: '', address: 'АДРЕС ТЕСТ' }], 'Брест город')).toMatchObject({ cities: ['Брест город'], noCity: [] })
  })
  it('два адреса: у одного город есть, у другого нет — регион добавляется', () => {
    expect(calendarCities(schedules, [{ city: 'Брест', address: 'x' }, { city: '', address: 'АДРЕС ТЕСТ' }], 'Иваново').cities).toEqual(['Брест', 'Иваново'])
    expect(calendarCities(schedules, [{ city: 'Брест', address: 'x' }, { city: '', address: 'АДРЕС ТЕСТ' }], null).noCity).toEqual(['АДРЕС ТЕСТ'])
  })
  it('ничего не нашлось — адрес в noCity', () => {
    expect(calendarCities(schedules, [{ city: '', address: 'АДРЕС ТЕСТ' }], null)).toMatchObject({ cities: [], noCity: ['АДРЕС ТЕСТ'] })
  })
  it('источник города по каждому адресу и пометка про бизнес-регион', () => {
    const r = calendarCities(schedules, [
      { city: 'Брест', address: 'ул. 1' },
      { city: '', address: 'г. Иваново, ул. 2' },
      { city: '', address: 'АДРЕС ТЕСТ' },
    ], 'Брест город')
    expect(r.addresses).toEqual([
      { address: 'ул. 1', city: 'Брест', source: 'column' },
      { address: 'г. Иваново, ул. 2', city: 'Иваново', source: 'text' },
      { address: 'АДРЕС ТЕСТ', city: null, source: 'none' },
    ])
    expect(r.byRegion).toBe(true)
  })
  it('все адреса с городом — дни не по региону', () => {
    expect(calendarCities(schedules, [{ city: 'Брест', address: 'x' }], 'Иваново').byRegion).toBe(false)
    expect(calendarCities(schedules, [], 'Иваново').byRegion).toBe(true)
    expect(calendarCities(schedules, [], null).byRegion).toBe(false)
  })
  it('одинаковый адрес дважды — в «Куда возим» один раз', () => {
    const a = { city: '', address: 'г. Иваново, ул. Ленина, 1' }
    expect(calendarCities(schedules, [a, a], null).addresses).toHaveLength(1)
  })
})
