import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from '../server/db/sqlite'
import { ODataClient } from '../server/services/onecOdata'
import { OdataOnec } from '../server/services/onecOdataSource'
import { isClientOrder, mapTrip, onecDateTime, readTrips, tripStatusOf, type TripDocRow } from '../server/services/onecOdataTrips'
import { sqliteVersionStore } from '../server/utils/odataVersions'
import { Trip } from '../shared/onec/schemas'

const G = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ORDER_TYPE = 'StandardODATA.Document_ЗаказКлиента'
const doc = (over: Partial<TripDocRow> = {}): TripDocRow => ({
  Ref_Key: G(1).toUpperCase(), Number: 'ЗП-1', DataVersion: 'v1', Статус: 'КПогрузке',
  ДатаВремяРейсаПланС: '2026-10-23T08:00:00', ДатаВремяРейсаПланПо: '2026-10-23T14:00:00', ДатаВремяРейсаФактС: '0001-01-01T00:00:00',
  АвтомобильГосударственныйНомер: ' 1234 AB-7 ',
  Маршрут: [{ Зона_Key: G(50) }, { Зона_Key: G(50) }, { Зона_Key: '00000000-0000-0000-0000-000000000000' }],
  Распоряжения: [{ Распоряжение: G(70), Распоряжение_Type: ORDER_TYPE }, { Распоряжение: G(71), Распоряжение_Type: 'StandardODATA.Document_ПеремещениеТоваров' }, { Распоряжение: G(70), Распоряжение_Type: ORDER_TYPE }],
  ...over,
})
const orders = new Map([[G(70), { number: 'ЗК-7', clientGuid: G(9) }]])

describe('рейсы по OData: сопоставление', () => {
  it('рейс контракта: даты с зоной, зоны и заказы без дублей, только заказы клиентов', () => {
    const t = mapTrip(doc(), orders, '2026-10-21T00:00:00+03:00')!
    expect(t).toMatchObject({
      guid: G(1), number: 'ЗП-1', status: 'loading', plannedStart: '2026-10-23T08:00:00+03:00', plannedEnd: '2026-10-23T14:00:00+03:00',
      actualStart: null, actualEnd: null, vehicle: '1234 AB-7', regionGuids: [G(50)], orders: [{ orderGuid: G(70), number: 'ЗК-7', clientGuid: G(9) }], deleted: false,
    })
    expect(Trip.safeParse(t).success).toBe(true)
  })

  it('без плановой даты — не рейс; статусы; тип распоряжения; пустая дата', () => {
    expect(mapTrip(doc({ ДатаВремяРейсаПланС: '0001-01-01T00:00:00' }), orders, '')).toBeNull()
    expect(['Формируется', 'КПогрузке', 'Отправлено', 'Закрыто', 'Что-то'].map(tripStatusOf)).toEqual(['forming', 'loading', 'sent', 'closed', 'forming'])
    expect(isClientOrder(ORDER_TYPE)).toBe(true)
    expect(isClientOrder('StandardODATA.Document_ЗаказКлиентаЧужой')).toBe(false)
    expect(onecDateTime(undefined)).toBeNull()
  })
})

describe('рейсы по OData: чтение', () => {
  const fake = (docs: TripDocRow[], seen: string[] = []): typeof fetch => async (u) => {
    const url = decodeURIComponent(String(u))
    seen.push(url)
    if (url.includes('Document_ЗаданиеНаПеревозку')) return Response.json({ value: docs })
    if (url.includes('Document_ЗаказКлиента')) return Response.json({ value: [{ Ref_Key: G(70), Number: 'ЗК-7', Партнер_Key: G(9).toUpperCase() }] })
    return Response.json({ value: [] })
  }
  const client = (f: typeof fetch) => new ODataClient({ baseUrl: 'https://x/b/odata/standard.odata', auth: { kind: 'bearer', token: 't' }, fetch: f })

  it('окно по плановой дате, номера заказов — из заказов, только заказы клиентов', async () => {
    const seen: string[] = []
    const rows = await readTrips(client(fake([doc()], seen)), new Date('2026-10-21T09:00:00Z'))
    expect(rows[0]!.trip.orders).toEqual([{ orderGuid: G(70), number: 'ЗК-7', clientGuid: G(9) }])
    expect(seen[0]).toContain("Posted eq true and ДатаВремяРейсаПланС ge datetime'2026-10-14T12:00:00' and ДатаВремяРейсаПланС le datetime'2026-11-20T12:00:00'")
    const orderQuery = seen.find(u => u.includes('Document_ЗаказКлиента'))!
    expect(orderQuery).toContain(G(70))
    expect(orderQuery).not.toContain(G(71))
  })

  it('OdataOnec.trips: момент держится, пока не изменился документ или его заказы', async () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    let clock = new Date('2026-10-21T09:00:00Z')
    let docs = [doc()]
    const api = new OdataOnec(client(async (u, i) => fake(docs)(u, i)), sqliteVersionStore(db), { now: () => clock, ttlMs: 0, tripsEnabled: true })
    const first = (await api.trips({})).items[0]!.changedAt
    clock = new Date('2026-10-21T10:00:00Z')
    expect((await api.trips({})).items[0]!.changedAt).toBe(first)
    docs = [doc({ DataVersion: 'v2' })]
    expect((await api.trips({})).items[0]!.changedAt).toBe('2026-10-21T10:00:00.000Z')
  })
})

describe('рейсы по OData: края', () => {
  const client = (f: typeof fetch) => new ODataClient({ baseUrl: 'https://x/b/odata/standard.odata', auth: { kind: 'bearer', token: 't' }, fetch: f })
  it('удалённый, пустой номер, кривые GUID распоряжений не попадают в фильтр', () => {
    const t = mapTrip(doc({ DeletionMark: true, Number: '  ', Распоряжения: [{ Распоряжение: "x') or (1 eq 1", Распоряжение_Type: ORDER_TYPE }] }), orders, '')!
    expect(t).toMatchObject({ deleted: true, number: G(1).toUpperCase(), orders: [] })
    expect(mapTrip(doc(), orders, '')!.deleted).toBe(false)
    expect(mapTrip(doc({ ДатаВремяРейсаПланС: undefined }), orders, '')).toBeNull()
  })

  it('заказы пачками по 40; сломанный рейс пропущен; пустой DataVersion — версия пустая; нет табличных частей — ошибка', async () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ Распоряжение: G(200 + i), Распоряжение_Type: ORDER_TYPE }))
    const seen: string[] = []
    const docs = [doc({ Распоряжения: many }), doc({ Ref_Key: G(2), DataVersion: '', Number: 'ЗП-2' }), doc({ Ref_Key: G(3), АвтомобильГосударственныйНомер: undefined, Маршрут: [{ Зона_Key: G(50) }], Статус: 'Отправлено', ДатаВремяРейсаПланС: 'кривая' })]
    const f: typeof fetch = async (u) => {
      const url = decodeURIComponent(String(u))
      seen.push(url)
      if (url.includes('Document_ЗаданиеНаПеревозку')) return Response.json({ value: docs })
      const ids = [...url.matchAll(/guid'([^']+)'/g)].map(m => m[1])
      return Response.json({ value: ids.map(id => ({ Ref_Key: id, Number: 'ЗК', Партнер_Key: G(9) })) })
    }
    const stats = { read: 0, noPlan: 0, broken: 0, ordersMissing: 0 }
    const rows = await readTrips(client(f), new Date('2026-10-21T09:00:00Z'), stats)
    expect(seen.filter(u => u.includes('Document_ЗаказКлиента'))).toHaveLength(2)
    expect(rows.find(r => r.trip.guid === G(1))!.trip.orders).toHaveLength(41)
    expect(rows.find(r => r.trip.guid === G(2))!.version).toBe('')
    expect(stats).toMatchObject({ read: 3, broken: 1 })
    const bare: typeof fetch = async () => Response.json({ value: [{ Ref_Key: G(1), ДатаВремяРейсаПланС: '2026-10-23T08:00:00' }] })
    await expect(readTrips(client(bare), new Date())).rejects.toMatchObject({ kind: 'contract' })
  })

  it('рейсы выключены — отказ 501; включены — заказ знает свой рейс', async () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const f: typeof fetch = async (u) => {
      const url = decodeURIComponent(String(u))
      if (url.includes('Document_ЗаданиеНаПеревозку')) return Response.json({ value: [doc()] })
      if (url.includes('startswith')) return Response.json({ value: [{ Ref_Key: G(70), Number: 'ЗК-7', НомерПоДаннымКлиента: 'ЛК-5', DataVersion: 'o1', Posted: true, Статус: 'КОтгрузке' }] })
      return Response.json({ value: [{ Ref_Key: G(70), Number: 'ЗК-7', Партнер_Key: G(9) }] })
    }
    await expect(new OdataOnec(client(f), sqliteVersionStore(db), {}).trips({})).rejects.toMatchObject({ status: 501 })
    const on = new OdataOnec(client(f), sqliteVersionStore(db), { tripsEnabled: true, ttlMs: 0 })
    expect((await on.orderStatus({})).items[0]).toMatchObject({ orderGuid: G(70), tripGuid: G(1) })
    const off = new OdataOnec(client(f), sqliteVersionStore(db), { ttlMs: 0 })
    expect((await off.orderStatus({})).items[0]!.tripGuid).toBeNull()
  })
})
