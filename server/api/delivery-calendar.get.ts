// Раздел «Доставка» (#79): дни приезда машины в города адресов клиента на две недели и отсечка
// приёма заявок по городам адресов клиента из сессии; плюс общий график по всем городам графика и
// адреса без города — чтобы объяснить клиенту, почему своих дней нет.
import { deliveryCalendar } from '../../shared/delivery'

export const CLIENT_CALENDAR_DAYS = 14

export default defineEventHandler(async (event) => {
  const ctx = await orderContext(event)
  if (ctx.pricing.status !== 'ok') return { status: ctx.pricing.status, days: [], cities: [], general: [], noCity: [] as string[] }
  const client = useClientStore().get(ctx.pricing.clientGuid)
  if (!client || client.deleted) return { status: 'no-contract' as const, days: [], cities: [], general: [], noCity: [] as string[] }
  const cities = [...new Set(client.addresses.map(a => a.city.trim()).filter(Boolean))]
  const noCity = [...new Set(client.addresses.filter(a => !a.city.trim()).map(a => a.address.trim()).filter(Boolean))]
  let schedules: Awaited<ReturnType<typeof cachedSchedules>>
  try {
    schedules = await cachedSchedules()
  }
  catch {
    return { status: 'unavailable' as const, days: [], cities, general: [], noCity }
  }
  const now = new Date()
  const days = cities.length ? deliveryCalendar(schedules, now, CLIENT_CALENDAR_DAYS, cities).filter(d => d.cities.length) : []
  const general = deliveryCalendar(schedules, now, CLIENT_CALENDAR_DAYS).filter(d => d.cities.length)
  return { status: 'ok' as const, days, cities, general, noCity }
})
