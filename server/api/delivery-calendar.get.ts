// Раздел «Доставка» (#79): дни приезда машины в города адресов клиента на две недели и отсечка
// приёма заявок по городам адресов клиента из сессии; плюс общий график по всем городам графика и
// адреса без города — чтобы объяснить клиенту, почему своих дней нет. `addresses`, `region`, `byRegion`
// — блок «Куда возим»: что заведено в 1С и откуда взят город.
import { deliveryCalendar } from '../../shared/delivery'
import { calendarCities } from '../utils/deliveryCities'

export const CLIENT_CALENDAR_DAYS = 14

export default defineEventHandler(async (event) => {
  const ctx = await orderContext(event)
  if (ctx.pricing.status !== 'ok') return { status: ctx.pricing.status, days: [], cities: [], general: [], noCity: [] as string[] }
  const client = useClientStore().get(ctx.pricing.clientGuid)
  if (!client || client.deleted) return { status: 'no-contract' as const, days: [], cities: [], general: [], noCity: [] as string[] }
  let schedules: Awaited<ReturnType<typeof cachedSchedules>>
  try {
    schedules = await cachedSchedules()
  }
  catch {
    const { cities, noCity, addresses, byRegion } = calendarCities([], client.addresses, client.regionName)
    return { status: 'unavailable' as const, days: [], cities, general: [], noCity, addresses, region: client.regionName, byRegion }
  }
  const { cities, noCity, addresses, byRegion } = calendarCities(schedules, client.addresses, client.regionName)
  const now = new Date()
  const days = cities.length ? deliveryCalendar(schedules, now, CLIENT_CALENDAR_DAYS, cities).filter(d => d.cities.length) : []
  const general = deliveryCalendar(schedules, now, CLIENT_CALENDAR_DAYS).filter(d => d.cities.length)
  return { status: 'ok' as const, days, cities, general, noCity, addresses, region: client.regionName, byRegion }
})
