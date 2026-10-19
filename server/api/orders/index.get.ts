// «Мои заявки» — только компании из сессии, новые сверху. Рейс — из заданий на перевозку 1С.
export default defineEventHandler(async (event) => {
  const ctx = await orderContext(event)
  const delivery = useDelivery()
  const items = useOrderStore().list(ctx.session.companyId, 20, Number(getQuery(event).offset)).map(({ tripGuid, ...o }) => {
    const trip = tripGuid ? delivery.trip(tripGuid) : null
    // Клиенту — дата и статус рейса, без машины и номера задания: это внутреннее у поставщика.
    return { ...o, trip: trip ? { plannedStart: trip.plannedStart, status: trip.status } : null }
  })
  return { items }
})
