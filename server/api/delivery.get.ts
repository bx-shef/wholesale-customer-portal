// Адреса доставки клиента из 1С и ближайший рейс в его бизнес-регион — для корзины.
import { addressLine } from '../../shared/cart'
import { nextDelivery } from '../../shared/delivery'
const ADDRESSES_MAX = 20

export default defineEventHandler(async (event) => {
  const ctx = await orderContext(event)
  if (ctx.pricing.status !== 'ok') return { addresses: [], status: ctx.pricing.status }
  const client = useClientStore().get(ctx.pricing.clientGuid)
  if (!client || client.deleted) return { addresses: [], status: 'no-contract' as const }
  // График доставки — из базы ЛК (его привозит из 1С `sync:schedule`).
  let schedules: Awaited<ReturnType<typeof cachedSchedules>> | null = null
  try {
    schedules = await cachedSchedules()
  }
  catch (e) {
    console.error(`[delivery] schedules: ${(e as Error).name}`)
  }
  const now = new Date()
  return {
    status: 'ok' as const,
    // Запрет отгрузки в 1С: заявку примем, но предупредим клиента заранее.
    shipmentBlocked: client.shipmentBlocked,
    addresses: client.addresses.slice(0, ADDRESSES_MAX).map(a => ({
      guid: a.guid,
      label: addressLine(a.city, a.address),
      city: a.city,
      // График — по городу адреса (env, табличка логиста) или по бизнес-региону клиента (1С).
      slot: schedules ? nextDelivery(schedules, [a.city, client.regionGuid], now) : null,
      slotStatus: schedules ? 'ok' as const : 'unavailable' as const,
    })),
  }
})
