/**
 * Расписание доставки (docs/spec.md §8): рейс в город — по дням недели, с отсечкой приёма заявок
 * и окном прибытия; исключения — даты, когда рейса нет. Заявка до отсечки едет ближайшим рейсом,
 * позже — следующим. Чистые функции: часы и расписание передаются аргументами.
 *
 * Время — по Минску. Беларусь живёт в UTC+3 без перехода на летнее время, поэтому смещение
 * постоянное и не зависит от часового пояса сервера.
 */
export const MINSK_OFFSET_MIN = 180
const DAY_MS = 86_400_000
const LOOKAHEAD_DAYS = 28

export interface TripSchedule {
  /** Бизнес-регион 1С (GUID): график ведёт логист в 1С по регионам (docs/onec-contract.md §2.8). */
  region: string
  /** Дни недели ISO: 1 — понедельник … 7 — воскресенье. */
  weekdays: number[]
  /** Отсечка: за сколько дней до рейса и до какого времени (минуты от полуночи по Минску). */
  cutoffDaysBefore: number
  cutoffMinutes: number
  arrivalFromMinutes: number
  arrivalToMinutes: number
  /** Даты без рейса, `ГГГГ-ММ-ДД`. */
  exceptions: string[]
}

export interface DeliverySlot {
  /** Дата рейса, `ГГГГ-ММ-ДД` по Минску. */
  date: string
  arrivalFrom: string
  arrivalTo: string
  cutoffAt: string
}

/** По первым двум буквам: «пн» и «понедельник», «пт» и «пятница» — одно и то же. */
const WEEKDAY_WORDS: Record<string, number> = { пн: 1, по: 1, вт: 2, ср: 3, чт: 4, че: 4, пт: 5, пя: 5, сб: 6, су: 6, вс: 7, во: 7 }

/** «пн, ср, пт» или «1,3,5» → [1, 3, 5]. Непонятное отбрасывается. */
export function parseWeekdays(text: string): number[] {
  const out = new Set<number>()
  for (const part of text.toLowerCase().split(/[\s,;]+/).filter(Boolean)) {
    const n = WEEKDAY_WORDS[part.slice(0, 2)] ?? Number(part)
    if (Number.isInteger(n) && n >= 1 && n <= 7) out.add(n)
  }
  return [...out].sort()
}

/** «16:00» → 960. Непонятное — null. */
export function parseTime(text: string): number | null {
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(text)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? h * 60 + min : null
}

/** Список дат исключений: «2026-11-07, 07.11.2026» → ['2026-11-07']. */
export function parseDates(text: string): string[] {
  const out: string[] = []
  for (const part of text.split(/[\s,;]+/).filter(Boolean)) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(part)
    const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(part)
    if (iso) out.push(part)
    else if (ru) out.push(`${ru[3]}-${ru[2]}-${ru[1]}`)
  }
  return out
}

/** Полночь даты по Минску в мс UTC. */
const minskMidnight = (date: string) => Date.parse(`${date}T00:00:00Z`) - MINSK_OFFSET_MIN * 60_000
/** Дата по Минску для момента. */
const minskDate = (ms: number) => new Date(ms + MINSK_OFFSET_MIN * 60_000).toISOString().slice(0, 10)
/** ISO-день недели даты: 1 … 7. */
const isoWeekday = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1
const atMinutes = (date: string, minutes: number) => new Date(minskMidnight(date) + minutes * 60_000).toISOString()

const sameRegion = (a: string, b: string) => a.trim().toLowerCase().replace(/ё/g, 'е') === b.trim().toLowerCase().replace(/ё/g, 'е')

/**
 * Ближайший рейс, на который заявка ещё успевает. `region` — ключ графика или несколько кандидатов:
 * бизнес-регион 1С (GUID) или город адреса (график из env, `parseScheduleEnv`). Нет региона, графика
 * или рейсов на 4 недели — null.
 */
export function nextDelivery(schedules: TripSchedule[], region: string | null | undefined | (string | null | undefined)[], now: Date): DeliverySlot | null {
  const keys = (Array.isArray(region) ? region : [region]).filter((r): r is string => !!r && !!r.trim())
  if (!keys.length) return null
  const today = minskDate(now.getTime())
  let best: DeliverySlot | null = null
  for (const s of schedules) {
    if (!keys.some(k => sameRegion(s.region, k)) || s.weekdays.length === 0) continue
    for (let d = 0; d <= LOOKAHEAD_DAYS; d++) {
      const date = minskDate(minskMidnight(today) + d * DAY_MS + 12 * 3_600_000)
      if (!s.weekdays.includes(isoWeekday(date)) || s.exceptions.includes(date)) continue
      const cutoffDate = minskDate(minskMidnight(date) - s.cutoffDaysBefore * DAY_MS + 12 * 3_600_000)
      const cutoffAt = atMinutes(cutoffDate, s.cutoffMinutes)
      if (Date.parse(cutoffAt) <= now.getTime()) continue
      const slot = { date, arrivalFrom: atMinutes(date, s.arrivalFromMinutes), arrivalTo: atMinutes(date, s.arrivalToMinutes), cutoffAt }
      if (!best || slot.arrivalFrom < best.arrivalFrom) best = slot
      break
    }
  }
  return best
}

/** Строка графика из 1С (§2.8) → расписание для расчёта. Время уже проверено схемой (`ЧЧ:ММ`). */
export function scheduleFromOnec(row: { regionGuid: string, weekdays: number[], cutoffDaysBefore: number, cutoffTime: string, arrivalFrom: string, arrivalTo: string, exceptions: string[] }): TripSchedule {
  const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  return {
    region: row.regionGuid.toLowerCase(),
    weekdays: row.weekdays,
    cutoffDaysBefore: row.cutoffDaysBefore,
    cutoffMinutes: min(row.cutoffTime),
    arrivalFromMinutes: min(row.arrivalFrom),
    arrivalToMinutes: min(row.arrivalTo),
    exceptions: row.exceptions,
  }
}

/**
 * График доставки из env (решение владельца 2026-10-27, табличка логиста): дни через «;», город
 * через запятую — «Пн: Ивацевичи, Береза; Вт: Жабинка, …». Рейс — в город адреса доставки; времени
 * прибытия и отсечки в табличке нет: заявка едет ближайшим днём после сегодняшнего.
 */
export function parseScheduleEnv(text: string): { schedules: TripSchedule[], warnings: string[] } {
  const byCity = new Map<string, { city: string, days: Set<number> }>()
  const warnings: string[] = []
  for (const part of text.split(';').map(p => p.trim()).filter(Boolean)) {
    const m = /^([^:]+):(.*)$/.exec(part)
    const day = m ? parseWeekdays(m[1]!)[0] : undefined
    if (!m || !day) {
      warnings.push(`не понят день в «${part.slice(0, 20)}» — ожидается «Пн: Город, Город»`)
      continue
    }
    for (const city of m[2]!.split(',').map(c => c.trim()).filter(Boolean)) {
      const key = city.toLowerCase().replace(/ё/g, 'е')
      const e = byCity.get(key) ?? { city, days: new Set<number>() }
      e.days.add(day)
      byCity.set(key, e)
    }
  }
  const schedules = [...byCity.values()].map(e => ({
    region: e.city,
    weekdays: [...e.days].sort(),
    cutoffDaysBefore: 1,
    cutoffMinutes: 24 * 60 - 1,
    arrivalFromMinutes: 0,
    arrivalToMinutes: 0,
    exceptions: [],
  }))
  return { schedules, warnings }
}

/** «пт, 16 октября, 10:00–14:00» — как в docs/spec.md §8; без окна прибытия — только день. */
export function formatSlot(slot: Pick<DeliverySlot, 'arrivalFrom' | 'arrivalTo'>): string {
  const opts = { timeZone: 'Europe/Minsk' } as const
  const day = new Date(slot.arrivalFrom).toLocaleDateString('ru-RU', { ...opts, weekday: 'short', day: 'numeric', month: 'long' })
  if (slot.arrivalFrom === slot.arrivalTo) return day
  const time = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { ...opts, hour: '2-digit', minute: '2-digit' })
  return `${day}, ${time(slot.arrivalFrom)}–${time(slot.arrivalTo)}`
}

/** Отсечка для людей: «до чт, 15 октября, 16:00». */
export function formatCutoff(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Minsk', weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}
