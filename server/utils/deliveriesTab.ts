/**
 * Вкладка «Ближайшие доставки» на странице приложения в коробке: рейсы из заданий на перевозку 1С
 * на сегодня и неделю вперёд — для информирования сотрудников (решение владельца 2026-10-19).
 * Только чтение: график и рейсы правятся в 1С.
 *
 * Кто смотрит — решает портал: токен фрейма проверяем вызовом `user.current` от имени сотрудника.
 * Видно сотрудникам поставщика: у пользователя есть подразделение (`UF_DEPARTMENT`) или он
 * администратор. Экстранет и внешние пользователи портала (без подразделения) — отказ: в рейсах
 * названия клиентов и номера заказов.
 */
import { z } from 'zod'
import { normalizeHost, type UserCall } from './managerTab'
import type { UpcomingTrip } from './delivery'

export const deliveriesRequestSchema = z.object({
  domain: z.string().min(1).max(253),
  authId: z.string().min(1).max(256),
})

/** Окно вкладки: с начала сегодняшнего дня по Минску на 7 дней вперёд. */
export const DELIVERIES_DAYS = 7
const MINSK_OFFSET_MS = 3 * 3_600_000

export function deliveriesWindow(now: Date): { from: Date, to: Date } {
  const minsk = new Date(now.getTime() + MINSK_OFFSET_MS)
  const from = new Date(Date.UTC(minsk.getUTCFullYear(), minsk.getUTCMonth(), minsk.getUTCDate()) - MINSK_OFFSET_MS)
  return { from, to: new Date(from.getTime() + DELIVERIES_DAYS * 86_400_000) }
}

export type DeliveriesResult =
  | { status: 200, body: { trips: UpcomingTrip[], from: string, to: string } }
  | { status: 403, body: { error: string } }

export async function readDeliveries(
  req: z.infer<typeof deliveriesRequestSchema>,
  deps: { allowedHosts: string[], userCall: UserCall, upcoming: (from: Date, to: Date) => UpcomingTrip[] },
  now = new Date(),
): Promise<DeliveriesResult> {
  const denied = { status: 403 as const, body: { error: 'Откройте вкладку из портала Битрикс24' } }
  const host = normalizeHost(req.domain)
  if (!host || !deps.allowedHosts.includes(host)) return denied
  try {
    const me = await deps.userCall(host, req.authId, 'user.current', {}) as { ID?: string | number, UF_DEPARTMENT?: unknown } | null
    if (!(Number(me?.ID) > 0)) return denied
    const staff = Array.isArray(me?.UF_DEPARTMENT) && me.UF_DEPARTMENT.some(d => Number(d) > 0)
    if (!staff && (await deps.userCall(host, req.authId, 'user.admin', {})) !== true) return denied
  }
  catch {
    return denied
  }
  const { from, to } = deliveriesWindow(now)
  return { status: 200, body: { trips: deps.upcoming(from, to), from: from.toISOString(), to: to.toISOString() } }
}
