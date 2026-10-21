/**
 * Рейсы 1С по OData (docs/onec-odata.md, «Рейсы»): документы `Document_ЗаданиеНаПеревозку` за
 * окно дат в форме `Trip` контракта (§2.9). Зоны — из табличной части «Маршрут», заказы — из
 * «Распоряжения» (только заказы клиентов; номер и клиент — из самих заказов).
 *
 * Имена полей и значения статуса — из типовой ERP, документ сейчас выпал из публикации; включается
 * `ONEC_ODATA_TRIPS`, проверить стендом, когда его вернут.
 */
import { Trip, type TripT } from '../../shared/onec/schemas'
import { OnecError } from './onec'
import { EMPTY_REF, ONEC_TZ, type ODataClient } from './onecOdata'
import { listAll } from './onecOdataClients'

export const TRIP_SET = 'Document_ЗаданиеНаПеревозку'
/** Окно рейсов: прошлые — 14 дней (для «доставлен»), будущие — все, что уже запланированы. */
export const TRIP_PAST_DAYS = 14

export interface TripDocRow {
  Ref_Key: string
  Number?: string
  DataVersion?: string
  DeletionMark?: boolean
  Статус?: string
  ДатаВремяРейсаПланС?: string
  ДатаВремяРейсаПланПо?: string
  ДатаВремяРейсаФактС?: string
  ДатаВремяРейсаФактПо?: string
  АвтомобильГосударственныйНомер?: string
  Маршрут?: Array<{ Зона_Key?: string }>
  Распоряжения?: Array<{ Распоряжение?: string, Распоряжение_Type?: string }>
}

const ref = (v: string | undefined) => (v && v !== EMPTY_REF ? v.toLowerCase() : null)

/** Дата-время 1С (местное, без зоны) → ISO с зоной Минска; пустое (`0001-…`) — `null`. */
export function onecDateTime(v: string | undefined): string | null {
  if (!v || v.startsWith('0001')) return null
  return `${v.slice(0, 19)}${ONEC_TZ}`
}

/** Статус рейса по перечислению 1С; незнакомый — «формируется»: так рейс клиенту ничего не обещает. */
export function tripStatusOf(s: string | undefined): TripT['status'] {
  switch ((s ?? '').trim()) {
    case 'КПогрузке': return 'loading'
    case 'Отправлено': return 'sent'
    case 'Закрыто': return 'closed'
    default: return 'forming'
  }
}

/** Распоряжение — заказ клиента (а не перемещение или возврат). */
export const isClientOrder = (type: string | undefined) => /Document_ЗаказКлиента$/.test(type ?? '')

/**
 * Рейс контракта из документа. `orders` — найденные заказы клиентов по ссылке (номер и клиент);
 * распоряжения, которых там нет, пропускаются. Без плановой даты рейс клиенту не показать — `null`.
 */
export function mapTrip(d: TripDocRow, orders: Map<string, { number: string, clientGuid: string }>, changedAt: string): TripT | null {
  const plannedStart = onecDateTime(d.ДатаВремяРейсаПланС)
  if (!plannedStart) return null
  const zones = [...new Set((d.Маршрут ?? []).flatMap(m => (ref(m.Зона_Key) ? [ref(m.Зона_Key)!] : [])))]
  const tripOrders = (d.Распоряжения ?? []).flatMap((r) => {
    const g = ref(r.Распоряжение)
    const o = g && isClientOrder(r.Распоряжение_Type) ? orders.get(g) : undefined
    return o ? [{ orderGuid: g!, number: o.number, clientGuid: o.clientGuid }] : []
  })
  return {
    guid: d.Ref_Key.toLowerCase(),
    number: (d.Number ?? '').trim() || d.Ref_Key,
    status: tripStatusOf(d.Статус),
    plannedStart,
    plannedEnd: onecDateTime(d.ДатаВремяРейсаПланПо),
    actualStart: onecDateTime(d.ДатаВремяРейсаФактС),
    actualEnd: onecDateTime(d.ДатаВремяРейсаФактПо),
    vehicle: (d.АвтомобильГосударственныйНомер ?? '').trim(),
    regionGuids: zones,
    orders: [...new Map(tripOrders.map(o => [o.orderGuid, o])).values()],
    changedAt,
    deleted: d.DeletionMark === true,
  }
}

/** Рейсы окна с версией документа: момент изменения ставит вызывающий (`stampByVersion`). */
export async function readTrips(client: ODataClient, now: Date): Promise<Array<{ trip: TripT, version: string }>> {
  const since = new Date(now.getTime() - TRIP_PAST_DAYS * 86_400_000 + 3 * 3_600_000).toISOString().slice(0, 19)
  const docs = await listAll<TripDocRow>(client, TRIP_SET, {
    $select: 'Ref_Key,Number,DataVersion,DeletionMark,Статус,ДатаВремяРейсаПланС,ДатаВремяРейсаПланПо,ДатаВремяРейсаФактС,ДатаВремяРейсаФактПо,АвтомобильГосударственныйНомер,Маршрут,Распоряжения',
    $filter: `ДатаВремяРейсаПланС ge datetime'${since}'`,
  })
  const want = [...new Set(docs.flatMap(d => (d.Распоряжения ?? []).flatMap(r => (isClientOrder(r.Распоряжение_Type) && ref(r.Распоряжение) ? [ref(r.Распоряжение)!] : []))))]
  const orders = new Map<string, { number: string, clientGuid: string }>()
  for (let i = 0; i < want.length; i += 40) {
    const rows = await client.list<{ Ref_Key: string, Number?: string, Партнер_Key?: string }>('Document_ЗаказКлиента', {
      $select: 'Ref_Key,Number,Партнер_Key',
      $filter: want.slice(i, i + 40).map(g => `Ref_Key eq guid'${g}'`).join(' or '),
    })
    for (const r of rows) {
      const client = ref(r.Партнер_Key)
      if (client) orders.set(r.Ref_Key.toLowerCase(), { number: (r.Number ?? '').trim() || r.Ref_Key, clientGuid: client })
    }
  }
  const out: Array<{ trip: TripT, version: string }> = []
  for (const d of docs) {
    const trip = mapTrip(d, orders, `2000-01-01T00:00:00${ONEC_TZ}`)
    if (!trip) continue
    const parsed = Trip.safeParse(trip)
    if (!parsed.success) throw new OnecError('contract', `1C OData trips: ${d.Number ?? d.Ref_Key} breaks contract at ${parsed.error.issues.slice(0, 3).map(x => x.path.join('.')).join(', ')}`)
    // Версия — документ и заказы в нём: номер заказа или клиент сменились — рейс изменён.
    out.push({ trip, version: `${d.DataVersion ?? ''}|${JSON.stringify(trip.orders)}` })
  }
  return out
}
