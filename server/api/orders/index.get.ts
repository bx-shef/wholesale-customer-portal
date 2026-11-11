import { nextDelivery } from '../../../shared/delivery'
import { cityInText } from '../../utils/orders'
import { ordersPage } from '../../../shared/orderList'

// «Мои заявки» — только компании из сессии, новые сверху, по вкладкам и страницам (#153). Рейс — из заданий на перевозку 1С.
export default defineEventHandler(async (event) => {
  const ctx = await orderContext(event)
  const delivery = useDelivery()
  const { rows, ...pageInfo } = ordersPage(ctx.session, getQuery(event), useOrderStore())
  // «Точно приедет» (решение клиента 2026-10-27): доставка подтверждена в 1С по четырём статусам —
  // клиенту ближайший день по графику его города. График недоступен — подсветки нет, заявки показываем.
  let schedules: Awaited<ReturnType<typeof cachedSchedules>> | null = null
  if (rows.some(r => r.deliveryConfirmed)) schedules = await cachedSchedules().catch(() => null)
  const now = new Date()
  const items = rows.map(({ tripGuid, deliveryConfirmed, ...o }) => {
    const trip = tripGuid ? delivery.trip(tripGuid) : null
    // Заказ уже собран и в закрытом рейсе — отсечка приёма заявок не важна: ближайший день графика, включая сегодня.
    const days = schedules?.map(s => ({ ...s, cutoffDaysBefore: 0, cutoffMinutes: 1439 }))
    const slot = deliveryConfirmed && days ? nextDelivery(days, [cityInText(days, o.address)], now) : null
    // Клиенту — дата и статус рейса, без машины и номера задания: это внутреннее у поставщика.
    return { ...o, trip: trip ? { plannedStart: trip.plannedStart, status: trip.status } : null, confirmedDate: slot?.date ?? null }
  })
  return { items, ...pageInfo }
})
