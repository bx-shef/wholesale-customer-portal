/**
 * Заявки ЛК в CRM коробки (docs/spec.md §4): сделка в воронке «Заявки ЛК» с товарами, ближайший
 * рейс из смарт-процесса «Рейсы», «Заказать звонок» — делом ответственному за компанию.
 * Транспорт — `call(method, params)` (B24Hook), в тестах — подделка.
 */
import { DEAL_CATEGORY_NAME, SMART_PROCESSES, spFieldName } from '../../shared/b24Setup'
import { parseDates, parseTime, parseWeekdays, type TripSchedule } from '../../shared/delivery'
import { resolveFieldKey, type B24Call } from './b24Access'

/** Источник сделок ЛК: по паре ORIGINATOR_ID + ORIGIN_ID повторная отправка находит уже созданную. */
export const DEAL_ORIGINATOR = 'wholesale-portal'
const TRIPS_TITLE = SMART_PROCESSES.find(sp => sp.title === 'Рейсы')!.title
/** Записей расписания — по одной на город; больше сотни — это уже не расписание, а ошибка ввода. */
const SCHEDULES_MAX = 100

export interface DealRow { name: string, price: number, qty: number, unit: string, vatRate: number }

export interface DealInput {
  requestId: string
  companyId: number
  contactId: number
  title: string
  comments: string
  total: number
  currency: string
  rows: DealRow[]
}

export function createB24Orders(call: B24Call) {
  let tripsMeta: Promise<{ entityTypeId: number, fields: Record<'city' | 'weekdays' | 'cutoffTime' | 'cutoffDays' | 'arrivalFrom' | 'arrivalTo' | 'exceptions', string> }> | undefined
  let categoryId: Promise<number> | undefined
  // Ошибка не кэшируется: после pnpm b24:setup следующий вызов найдёт смарт-процесс и воронку.
  const retryable = <T>(get: () => Promise<T> | undefined, set: (v: Promise<T> | undefined) => void, load: () => Promise<T>) => {
    const cur = get()
    if (cur) return cur
    const p = load().catch((e) => {
      set(undefined)
      throw e
    })
    set(p)
    return p
  }

  const getTripsMeta = () => retryable(() => tripsMeta, v => (tripsMeta = v), async () => {
    const { types } = await call('crm.type.list', { filter: { title: TRIPS_TITLE } }) as { types: { id: number, entityTypeId: number, title: string }[] }
    const type = types.find(t => t.title === TRIPS_TITLE)
    if (!type) throw new Error(`Smart process «${TRIPS_TITLE}» not found — run pnpm b24:setup`)
    const { fields } = await call('crm.item.fields', { entityTypeId: type.entityTypeId }) as { fields: Record<string, unknown> }
    const pick = (postfix: string) => {
      const key = resolveFieldKey(Object.keys(fields), spFieldName(Number(type.id), postfix))
      if (!key) throw new Error(`Field ${spFieldName(Number(type.id), postfix)} not found — run pnpm b24:setup`)
      return key
    }
    return {
      entityTypeId: Number(type.entityTypeId),
      fields: {
        city: pick('CITY'), weekdays: pick('WEEKDAYS'), cutoffTime: pick('CUTOFF_TIME'), cutoffDays: pick('CUTOFF_DAYS'),
        arrivalFrom: pick('ARRIVAL_FROM'), arrivalTo: pick('ARRIVAL_TO'), exceptions: pick('EXCEPTIONS'),
      },
    }
  })

  const getCategoryId = () => retryable(() => categoryId, v => (categoryId = v), async () => {
    const { categories } = await call('crm.category.list', { entityTypeId: 2 }) as { categories: { id: number, name: string }[] }
    const cat = categories.find(c => c.name === DEAL_CATEGORY_NAME)
    if (!cat) throw new Error(`Deal category «${DEAL_CATEGORY_NAME}» not found — run pnpm b24:setup`)
    return Number(cat.id)
  })

  return {
    /**
     * Расписание рейсов. Запись без дней недели или с непонятным временем пропускается — и пишется в
     * журнал: менеджер видит, какую строку «Рейсов» поправить, а клиенту дату согласуют вручную.
     */
    async schedules(): Promise<TripSchedule[]> {
      const m = await getTripsMeta()
      const f = m.fields
      const { items } = await call('crm.item.list', { entityTypeId: m.entityTypeId, select: ['id', ...Object.values(f)] }) as { items: Record<string, unknown>[] }
      const out: TripSchedule[] = []
      for (const i of items.slice(0, SCHEDULES_MAX)) {
        const str = (k: keyof typeof f) => String(i[f[k]] ?? '')
        const cutoff = parseTime(str('cutoffTime'))
        const from = parseTime(str('arrivalFrom'))
        const to = parseTime(str('arrivalTo'))
        const weekdays = parseWeekdays(str('weekdays'))
        const days = Number(i[f.cutoffDays] ?? 1)
        if (!str('city').trim() || !weekdays.length || cutoff === null || from === null || to === null || to < from || !Number.isInteger(days) || days < 0 || days > 14) {
          console.warn(`[trips] schedule ${String(i.id)} skipped: fill city, weekdays, times HH:MM, cutoff days 0–14`)
          continue
        }
        out.push({ city: str('city'), weekdays, cutoffDaysBefore: days, cutoffMinutes: cutoff, arrivalFromMinutes: from, arrivalToMinutes: to, exceptions: parseDates(str('exceptions')) })
      }
      return out
    },

    /** Сделка с товарами. Повтор с тем же requestId находит прежнюю сделку и перезаписывает товары. */
    async createDeal(input: DealInput): Promise<number> {
      const found = await call('crm.deal.list', {
        filter: { ORIGINATOR_ID: DEAL_ORIGINATOR, ORIGIN_ID: input.requestId },
        select: ['ID', 'ORIGIN_ID'],
      }) as { ID: string, ORIGIN_ID: string }[]
      let dealId = Number(found.find(d => d.ORIGIN_ID === input.requestId)?.ID ?? 0)
      if (!dealId) {
        dealId = Number(await call('crm.deal.add', {
          fields: {
            TITLE: input.title,
            CATEGORY_ID: await getCategoryId(),
            COMPANY_ID: input.companyId,
            CONTACT_IDS: [input.contactId],
            COMMENTS: input.comments,
            OPPORTUNITY: input.total,
            CURRENCY_ID: input.currency,
            ORIGINATOR_ID: DEAL_ORIGINATOR,
            ORIGIN_ID: input.requestId,
          },
        }))
        if (!dealId) throw new Error('crm.deal.add returned no id')
      }
      await call('crm.deal.productrows.set', {
        id: dealId,
        rows: input.rows.map((r, i) => ({
          PRODUCT_ID: 0,
          PRODUCT_NAME: r.name,
          PRICE: r.price,
          QUANTITY: r.qty,
          MEASURE_NAME: r.unit,
          TAX_RATE: r.vatRate,
          // Цена из 1С — с НДС (контракт: цена клиента), налог в неё уже включён.
          TAX_INCLUDED: 'Y',
          SORT: (i + 1) * 10,
        })),
      })
      return dealId
    },

    /** «Заказать звонок»: дело на компании ответственному, срок — через час. */
    async requestCallback(input: { companyId: number, responsibleId: number | null, contactLabel: string, now?: Date }): Promise<number> {
      const deadline = new Date((input.now ?? new Date()).getTime() + 60 * 60_000).toISOString()
      const result = await call('crm.activity.todo.add', {
        ownerTypeId: 4,
        ownerId: input.companyId,
        deadline,
        title: 'Перезвонить клиенту из ЛК',
        description: `Клиент попросил перезвонить из личного кабинета: ${input.contactLabel}`,
        ...(input.responsibleId ? { responsibleId: input.responsibleId } : {}),
        pingOffsets: [0],
      }) as { id?: number } | number
      return typeof result === 'number' ? result : Number(result?.id ?? 0)
    },
  }
}

export type B24Orders = ReturnType<typeof createB24Orders>
