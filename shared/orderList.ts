/**
 * «Мои заявки» по вкладкам и страницам (#153) — одни правила для сервера и экрана.
 * Выполненные — доставленные и отменённые; всё остальное, включая ещё не отправленные, — в работе.
 */
export type OrderTab = 'active' | 'done'
export const DONE_STATUSES = ['delivered', 'cancelled'] as const
export const ORDERS_PAGE_SIZE = 20

export const orderTab = (status: string): OrderTab => (DONE_STATUSES as readonly string[]).includes(status) ? 'done' : 'active'

export const parseOrderTab = (raw: unknown): OrderTab => raw === 'done' ? 'done' : 'active'

/** Номер страницы из запроса: целое от 1; больше последней — последняя (пустой страницы не показываем). */
export function pageOf(raw: unknown, total: number, size = ORDERS_PAGE_SIZE): { page: number, offset: number } {
  const last = Math.max(Math.ceil(total / size), 1)
  const n = Math.trunc(Number(raw))
  const page = Math.min(Number.isFinite(n) && n >= 1 ? n : 1, last)
  return { page, offset: (page - 1) * size }
}

/** Хранилище заявок — то, что нужно странице списка. */
export interface OrderListSource<R> {
  tabCounts(companyId: number): Record<OrderTab, number>
  listTab(companyId: number, tab: OrderTab, limit: number, offset: number): R[]
}

/**
 * Решение страницы «Мои заявки»: компания — только из сессии (запрос её не задаёт),
 * вкладка и страница — из запроса, после разбора.
 */
export function ordersPage<R>(session: { companyId: number }, query: { tab?: unknown, page?: unknown }, store: OrderListSource<R>) {
  const tab = parseOrderTab(query.tab)
  const counts = store.tabCounts(session.companyId)
  const { page, offset } = pageOf(query.page, counts[tab])
  const rows = store.listTab(session.companyId, tab, ORDERS_PAGE_SIZE, offset)
  return { rows, tab, page, pageSize: ORDERS_PAGE_SIZE, total: counts[tab], counts }
}
