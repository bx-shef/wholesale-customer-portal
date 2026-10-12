// Адреса доставки клиента из 1С и ближайший рейс в город каждого — для корзины.
export default defineEventHandler(async (event) => {
  const ctx = await orderContext(event)
  if (ctx.pricing.status !== 'ok') return { addresses: [], status: ctx.pricing.status }
  const client = useClientStore().get(ctx.pricing.clientGuid)
  if (!client) return { addresses: [], status: 'no-contract' as const }
  const addresses = await Promise.all(client.addresses.map(async (a) => {
    try {
      return { ...a, trip: await cachedNearestTrip(a.city), tripStatus: 'ok' as const }
    }
    catch (e) {
      console.error(`[delivery] trips: ${(e as Error).name}`)
      return { ...a, trip: null, tripStatus: 'unavailable' as const }
    }
  }))
  return { addresses, status: 'ok' as const }
})
