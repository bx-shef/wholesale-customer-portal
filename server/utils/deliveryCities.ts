/**
 * Города клиента для раздела «Доставка» (2026-11-18): колонка «Город» адреса 1С часто пустая (адрес
 * введён строкой, «…, г. Иваново, ул. …»), поэтому город ищется и в тексте адреса по городам графика,
 * а если не нашёлся ни у одного адреса — берётся зона доставки клиента из 1С (зона = город).
 * В `noCity` — только адреса, для которых город не определился ни так, ни так.
 */
import type { TripSchedule } from '../../shared/delivery'
import { cityInText } from './orders'

export function calendarCities(schedules: TripSchedule[], addresses: { city: string, address: string }[], zone: string | null): { cities: string[], noCity: string[] } {
  const cities = new Set<string>()
  const unknown: string[] = []
  for (const a of addresses) {
    const city = a.city.trim() || (cityInText(schedules, a.address) ?? '')
    if (city) cities.add(city)
    else if (a.address.trim()) unknown.push(a.address.trim())
  }
  if (!cities.size && zone && zone.trim()) cities.add(zone.trim())
  return { cities: [...cities], noCity: cities.size ? [] : [...new Set(unknown)] }
}
