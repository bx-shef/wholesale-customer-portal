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
/** Окно рейсов по плановому началу: 7 дней назад (для «доставлен») и 30 вперёд — бережём 1С. */
export const TRIP_PAST_DAYS = 7
export const TRIP_AHEAD_DAYS = 30
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

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

/** Ссылка 1С: только настоящий GUID — он попадает в `$filter`, кривое значение пропускаем. */
const ref = (v: string | undefined) => {
  const g = (v ?? '').toLowerCase()
  return g && g !== EMPTY_REF && GUID.test(g) ? g : null
}

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
  if (!plannedStart || !ref(d.Ref_Key)) return null
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

export interface TripStats { read: number, noPlan: number, broken: number, ordersMissing: number }

/**
 * Рейсы окна с версией документа: момент изменения ставит вызывающий (`stampByVersion`). Только
 * проведённые (черновик — не рейс). Рейс, ломающий контракт, пропускается со счётчиком — поток
 * из-за одного документа не падает; не пришли табличные части вовсе — ошибка: значит, 1С их не отдаёт.
 */
export async function readTrips(client: ODataClient, now: Date, stats: TripStats = { read: 0, noPlan: 0, broken: 0, ordersMissing: 0 }): Promise<Array<{ trip: TripT, version: string }>> {
  const at = (days: number) => new Date(now.getTime() + days * 86_400_000 + 3 * 3_600_000).toISOString().slice(0, 19)
  const docs = await listAll<TripDocRow>(client, TRIP_SET, {
    $select: 'Ref_Key,Number,DataVersion,DeletionMark,Статус,ДатаВремяРейсаПланС,ДатаВремяРейсаПланПо,ДатаВремяРейсаФактС,ДатаВремяРейсаФактПо,АвтомобильГосударственныйНомер,Маршрут,Распоряжения',
    $filter: `Posted eq true and ДатаВремяРейсаПланС ge datetime'${at(-TRIP_PAST_DAYS)}' and ДатаВремяРейсаПланС le datetime'${at(TRIP_AHEAD_DAYS)}'`,
  })
  stats.read = docs.length
  if (docs.length && docs.every(d => d.Маршрут === undefined && d.Распоряжения === undefined)) throw new OnecError('contract', `1C OData ${TRIP_SET}: tabular parts Маршрут/Распоряжения not returned`)
  const want = [...new Set(docs.flatMap(d => (d.Распоряжения ?? []).flatMap(r => (isClientOrder(r.Распоряжение_Type) && ref(r.Распоряжение) ? [ref(r.Распоряжение)!] : []))))]
  const orders = new Map<string, { number: string, clientGuid: string }>()
  for (let i = 0; i < want.length; i += 40) {
    const rows = await client.list<{ Ref_Key: string, Number?: string, Партнер_Key?: string }>('Document_ЗаказКлиента', {
      $select: 'Ref_Key,Number,Партнер_Key',
      $filter: want.slice(i, i + 40).map(g => `Ref_Key eq guid'${g}'`).join(' or '),
    })
    for (const r of rows) {
      const partner = ref(r.Партнер_Key)
      if (partner) orders.set(r.Ref_Key.toLowerCase(), { number: (r.Number ?? '').trim() || r.Ref_Key, clientGuid: partner })
    }
  }
  stats.ordersMissing = want.filter(g => !orders.has(g)).length
  const out: Array<{ trip: TripT, version: string }> = []
  for (const d of docs) {
    const trip = mapTrip(d, orders, `2000-01-01T00:00:00${ONEC_TZ}`)
    if (!trip) {
      stats.noPlan++
      continue
    }
    if (!Trip.safeParse(trip).success) {
      stats.broken++
      continue
    }
    // Версия — документ и заказы в нём (по порядку GUID); без DataVersion — пусто: «изменён всегда».
    const ordersKey = JSON.stringify([...trip.orders].sort((a, b) => a.orderGuid.localeCompare(b.orderGuid)))
    out.push({ trip, version: d.DataVersion ? `${d.DataVersion}|${ordersKey}` : '' })
  }
  return out
}
