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
