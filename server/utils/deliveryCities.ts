/**
 * Города клиента для раздела «Доставка» (2026-11-18): колонка «Город» адреса 1С часто пустая (адрес
 * введён строкой, «…, г. Иваново, ул. …»), поэтому город ищется и в тексте адреса по городам графика,
 * а если не нашёлся ни у одного адреса — берётся зона доставки клиента из 1С (зона = город).
 * В `noCity` — только адреса, для которых город не определился ни так, ни так.
 * `addresses` — по каждому адресу город и откуда он взят (блок «Куда возим», 2026-11-19);
 * `byRegion` — дни подбираются ещё и по бизнес-региону клиента (есть адрес без города или адресов нет).
 */
import type { TripSchedule } from '../../shared/delivery'
import { cityInText } from './orders'

export type CitySource = 'column' | 'text' | 'none'
export interface AddressCity { address: string, city: string | null, source: CitySource }

export function calendarCities(schedules: TripSchedule[], addresses: { city: string, address: string }[], zone: string | null): { cities: string[], noCity: string[], addresses: AddressCity[], byRegion: boolean } {
  const cities = new Set<string>()
  const unknown: string[] = []
  const list: AddressCity[] = []
  for (const a of addresses) {
    const column = a.city.trim()
    const inText = column ? null : cityInText(schedules, a.address)
    const city = column || inText || ''
    list.push({ address: a.address.trim(), city: city || null, source: column ? 'column' : inText ? 'text' : 'none' })
    if (city) cities.add(city)
    else if (a.address.trim()) unknown.push(a.address.trim())
  }
  // Регион клиента — запасной город для адресов, где город не определился (и когда адресов нет).
  const hasZone = !!zone && !!zone.trim()
  const byRegion = hasZone && (unknown.length > 0 || !addresses.length)
  if (byRegion) cities.add(zone!.trim())
  return { cities: [...cities], noCity: hasZone ? [] : [...new Set(unknown)], addresses: list, byRegion }
}
