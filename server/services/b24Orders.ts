/**
 * Заявки ЛК в CRM коробки (docs/spec.md §4): сделка в воронке «Заявки ЛК» с товарами, ближайший
 * «Заказать звонок» — делом ответственному за компанию.
 * Транспорт — `call(method, params)` (B24Hook), в тестах — подделка.
 */
import { DEAL_CATEGORY_NAME } from '../../shared/b24Setup'
import { isNotFound, type B24Call } from './b24Access'

/** Источник сделок ЛК: по паре ORIGINATOR_ID + ORIGIN_ID повторная отправка находит уже созданную. */
export const DEAL_ORIGINATOR = 'wholesale-portal'

/** `unknown` — портал отдал семантику, которую мы не знаем: по такой стадии заказ не создаём. */
export interface DealStage { id: string, name: string, sort: number, semantics: 'process' | 'success' | 'failure' | 'unknown' }

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

  const getCategoryId = () => retryable(() => categoryId, v => (categoryId = v), async () => {
    const { categories } = await call('crm.category.list', { entityTypeId: 2 }) as { categories: { id: number, name: string }[] }
    const cat = categories.find(c => c.name === DEAL_CATEGORY_NAME)
    if (!cat) throw new Error(`Deal category «${DEAL_CATEGORY_NAME}» not found — run pnpm b24:setup`)
    return Number(cat.id)
  })

  return {
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

    /**
     * Стадии воронки «Заявки ЛК» по порядку: первая рабочая — «новая заявка», остальные рабочие —
     * «подтверждена менеджером»; успех и провал — закрытие. Семантику отдаёт портал, не угадываем.
     */
    async stages(): Promise<DealStage[]> {
      const cat = await getCategoryId()
      const rows = await call('crm.status.list', { filter: { ENTITY_ID: `DEAL_STAGE_${cat}` }, order: { SORT: 'ASC' } }) as Record<string, unknown>[]
      return rows.map((r) => {
        const extra = (r.EXTRA ?? {}) as Record<string, unknown>
        const sem = String(r.SEMANTICS ?? extra.SEMANTICS ?? '').toLowerCase()
        // Рабочая стадия у портала — пустая семантика или «P»/«process»; всё прочее незнакомое — unknown.
        const semantics: DealStage['semantics'] = sem === 's' || sem === 'success' ? 'success' : sem === 'f' || sem === 'failure' ? 'failure' : sem === '' || sem === 'p' || sem === 'process' ? 'process' : 'unknown'
        return { id: String(r.STATUS_ID), name: String(r.NAME ?? ''), sort: Number(r.SORT ?? 0), semantics }
      }).sort((a, b) => a.sort - b.sort)
    },

    /** Стадия сделки; сделки нет — null. */
    async dealStage(dealId: number): Promise<string | null> {
      try {
        const { item } = await call('crm.item.get', { entityTypeId: 2, id: dealId }) as { item?: Record<string, unknown> }
        return item?.stageId ? String(item.stageId) : null
      }
      catch (e) {
        if (isNotFound(e)) return null
        throw e
      }
    },

    async moveDeal(dealId: number, stageId: string): Promise<void> {
      await call('crm.item.update', { entityTypeId: 2, id: dealId, fields: { stageId } })
    },

    async comment(dealId: number, text: string): Promise<void> {
      await call('crm.timeline.comment.add', { fields: { ENTITY_ID: dealId, ENTITY_TYPE: 'deal', COMMENT: text } })
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
