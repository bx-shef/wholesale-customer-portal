/**
 * Доставка из 1С (решение владельца 2026-10-19: график и рейсы ведутся только в 1С, ЛК и Б24
 * читают). График по регионам (§2.8) — для «Машина приедет…» в корзине и заявке; задания на
 * перевозку (§2.9) — для статуса заказа и вкладки «Ближайшие доставки» в Битрикс24.
 */
import type { DatabaseSync } from 'node:sqlite'
import type { DeliveryScheduleT, TripT } from '../../shared/onec/schemas'
import { scheduleFromOnec, type TripSchedule } from '../../shared/delivery'

export interface UpcomingTrip {
  guid: string
  number: string
  status: TripT['status']
  plannedStart: string
  actualStart: string | null
  vehicle: string
  regions: string[]
  orders: { orderGuid: string, number: string, clientName: string | null }[]
}

export function createDeliveryStore(db: DatabaseSync) {
  const upsertTrip = db.prepare(`INSERT INTO trip (guid, number, status, planned_start, data, changed_at, deleted) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (guid) DO UPDATE SET number = excluded.number, status = excluded.status, planned_start = excluded.planned_start,
      data = excluded.data, changed_at = excluded.changed_at, deleted = excluded.deleted`)
  return {
    /** График приходит целиком: строки, которых нет в ответе, удалены в 1С. */
    saveSchedules(rows: DeliveryScheduleT[]) {
      db.exec('BEGIN IMMEDIATE')
      try {
        db.exec('DELETE FROM delivery_schedule')
        const ins = db.prepare('INSERT INTO delivery_schedule (region_guid, region_name, data) VALUES (?, ?, ?)')
        for (const r of rows) ins.run(r.regionGuid.toLowerCase(), r.regionName, JSON.stringify(r))
        db.exec('COMMIT')
      }
      catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
    schedules(): TripSchedule[] {
      return (db.prepare('SELECT data FROM delivery_schedule').all() as { data: string }[]).map(r => scheduleFromOnec(JSON.parse(r.data) as DeliveryScheduleT))
    },
    saveTrips(trips: TripT[]) {
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const t of trips) upsertTrip.run(t.guid.toLowerCase(), t.number, t.status, new Date(t.plannedStart).toISOString(), JSON.stringify(t), t.changedAt, t.deleted ? 1 : 0)
        db.exec('COMMIT')
      }
      catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
    /** Рейсы с плановым выездом в окне `[from, to)`, кроме удалённых; закрытые — тоже (видно, что доехали). */
    upcoming(from: Date, to: Date, limit = 200): UpcomingTrip[] {
      const rows = db.prepare(`SELECT data FROM trip WHERE deleted = 0 AND planned_start >= ? AND planned_start < ? ORDER BY planned_start, number LIMIT ?`)
        .all(from.toISOString(), to.toISOString(), limit) as { data: string }[]
      const regionName = db.prepare('SELECT region_name AS n FROM delivery_schedule WHERE region_guid = ?')
      const clientName = db.prepare('SELECT name AS n FROM onec_client WHERE guid = ?')
      return rows.map((r) => {
        const t = JSON.parse(r.data) as TripT
        return {
          guid: t.guid.toLowerCase(), number: t.number, status: t.status, plannedStart: t.plannedStart, actualStart: t.actualStart, vehicle: t.vehicle,
          regions: t.regionGuids.map(g => (regionName.get(g.toLowerCase()) as { n: string } | undefined)?.n ?? '—'),
          orders: t.orders.map(o => ({ orderGuid: o.orderGuid.toLowerCase(), number: o.number, clientName: (clientName.get(o.clientGuid.toLowerCase()) as { n: string } | undefined)?.n ?? null })),
        }
      })
    },
    trip(guid: string): { number: string, status: TripT['status'], plannedStart: string } | null {
      const row = db.prepare('SELECT number, status, planned_start AS plannedStart FROM trip WHERE guid = ? AND deleted = 0').get(guid.toLowerCase()) as { number: string, status: TripT['status'], plannedStart: string } | undefined
      return row ?? null
    },
  }
}

export type DeliveryStore = ReturnType<typeof createDeliveryStore>
