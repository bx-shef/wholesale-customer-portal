// Раздел «Доставка» (#79): дни приезда машины в города адресов клиента на две недели и отсечка
// приёма заявок. Только города адресов клиента из сессии — чужой график не отдаём.
import { deliveryCalendar } from '../../shared/delivery'

export const CLIENT_CALENDAR_DAYS = 14

export default defineEventHandler(async (event) => {
  const ctx = await orderContext(event)
  if (ctx.pricing.status !== 'ok') return { status: ctx.pricing.status, days: [], cities: [] }
  const client = useClientStore().get(ctx.pricing.clientGuid)
  if (!client || client.deleted) return { status: 'no-contract' as const, days: [], cities: [] }
  const cities = [...new Set(client.addresses.map(a => a.city.trim()).filter(Boolean))]
  let schedules: Awaited<ReturnType<typeof cachedSchedules>>
  try {
    schedules = await cachedSchedules()
  }
  catch {
    return { status: 'unavailable' as const, days: [], cities }
  }
  const days = deliveryCalendar(schedules, new Date(), CLIENT_CALENDAR_DAYS, cities).filter(d => d.cities.length)
  return { status: 'ok' as const, days, cities }
})
