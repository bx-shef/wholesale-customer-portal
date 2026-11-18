import { describe, expect, it } from 'vitest'
import { parseScheduleEnv } from '../shared/delivery'
import { calendarCities } from '../server/utils/deliveryCities'

const { schedules } = parseScheduleEnv('Вт: Иваново; Ср: Брест')

describe('города клиента для «Доставки» (2026-11-18)', () => {
  it('город из текста адреса, если колонка пустая', () => {
    const r = calendarCities(schedules, [{ city: '', address: '225793, Брестская обл., г. Иваново, ул. Карла Маркса, д. 51а' }], null)
    expect(r).toEqual({ cities: ['Иваново'], noCity: [] })
  })
  it('колонка «Город» главнее текста', () => {
    expect(calendarCities(schedules, [{ city: 'Брест', address: 'г. Иваново' }], null).cities).toEqual(['Брест'])
  })
  it('ни в адресе, ни в колонке — зона доставки клиента', () => {
    expect(calendarCities(schedules, [{ city: '', address: 'АДРЕС ТЕСТ' }], 'Брест город')).toEqual({ cities: ['Брест город'], noCity: [] })
  })
  it('два адреса: у одного город есть, у другого нет — регион добавляется', () => {
    expect(calendarCities(schedules, [{ city: 'Брест', address: 'x' }, { city: '', address: 'АДРЕС ТЕСТ' }], 'Иваново').cities).toEqual(['Брест', 'Иваново'])
    expect(calendarCities(schedules, [{ city: 'Брест', address: 'x' }, { city: '', address: 'АДРЕС ТЕСТ' }], null).noCity).toEqual(['АДРЕС ТЕСТ'])
  })
  it('ничего не нашлось — адрес в noCity', () => {
    expect(calendarCities(schedules, [{ city: '', address: 'АДРЕС ТЕСТ' }], null)).toEqual({ cities: [], noCity: ['АДРЕС ТЕСТ'] })
  })
})
