// Выбор соглашения клиентом (#46): цены и заявка — по выбранному из его действующих, чужое не подставить.
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { migrate } from '../server/db/sqlite'
import { createCatalogStore } from '../server/utils/catalog'
import { chooseContract, contractsOf, createClientStore } from '../server/utils/clients'
import { createOrderStore, submitOrder, type SubmitDeps } from '../server/utils/orders'
import { createPriceStore } from '../server/utils/prices'
import { contractLabel, parseContractCookie } from '../shared/contractChoice'
import type { ClientT, ContractT, ItemT } from '../shared/onec/schemas'

const g = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = '2026-10-01T00:00:00+03:00'
const contract = (n: number, priceType: number): ContractT => ({ guid: g(n), name: `Соглашение ${n}`, number: `С-${n}`, date: '2026-01-02', priceTypeGuid: g(priceType), paymentDelayDays: 0, creditLimit: 0, debt: 0, currency: 'BYN' })
const MAIN = contract(200, 30)
const SECOND = contract(201, 31)
const client = (over: Partial<ClientT> = {}): ClientT => ({
  guid: g(100), name: 'ООО «Клиент»', unp: '1', address: '', city: 'Минск', region: null, shipmentBlocked: false, managerEmail: '',
  contract: MAIN, contracts: [MAIN, SECOND], deliveryAddresses: [{ guid: g(300), city: 'Минск', address: 'ул. Строителей, 1' }], changedAt: at, deleted: false, ...over,
})
const item = (n: number): ItemT => ({ guid: g(n), sku: `S${n}`, name: `Товар ${n}`, sectionGuid: g(900), brand: '', unit: 'шт', packQty: 1, minQty: 1, description: '', properties: {}, images: [], analogs: [], changedAt: at, deleted: false })

function db() {
  const d = new DatabaseSync(':memory:')
  migrate(d)
  return d
}

describe('подпись и cookie', () => {
  it('подпись: наименование, номер, дата, валюта', () => {
    expect(contractLabel(SECOND)).toBe('Соглашение 201 № С-201 от 02.01.2026, BYN')
    expect(contractLabel({ ...SECOND, name: '', number: '' })).toBe('Соглашение от 02.01.2026, BYN')
  })
  it('cookie — только GUID, иначе null', () => {
    expect(parseContractCookie(g(201).toUpperCase())).toBe(g(201))
    for (const v of ['', 'x', "1' or 1=1", undefined, null]) expect(parseContractCookie(v)).toBeNull()
  })
})

describe('хранение и выбор', () => {
  it('основное первым, без повторов; у источника без списка — только основное', () => {
    expect(contractsOf({ contract: MAIN, contracts: [SECOND, MAIN] }).map(c => c.guid)).toEqual([g(200), g(201)])
    expect(contractsOf({ contract: MAIN, contracts: [] }).map(c => c.guid)).toEqual([g(200)])
    expect(contractsOf({ contract: null, contracts: [] })).toEqual([])
  })

  it('выбор: своё соглашение — оно; чужое или пустое — основное', () => {
    const store = createClientStore(db())
    store.save([client()])
    const c = store.get(g(100))!
    expect(c.contracts.map(x => x.guid)).toEqual([g(200), g(201)])
    expect(chooseContract(c, g(201))?.guid).toBe(g(201))
    expect(chooseContract(c, g(999))?.guid).toBe(g(200))
    expect(chooseContract(c, null)?.guid).toBe(g(200))
  })

  it('цены: по виду цен выбранного соглашения; чужое соглашение — основное', async () => {
    const d = db()
    createClientStore(d).save([client()])
    const prices = createPriceStore(d)
    prices.save([
      { priceTypeGuid: g(30), itemGuid: g(1), price: 10, currency: 'BYN', vatRate: 20, changedAt: at, deleted: false },
      { priceTypeGuid: g(31), itemGuid: g(1), price: 8, currency: 'BYN', vatRate: 20, changedAt: at, deleted: false },
    ])
    expect((await prices.get(g(100), [g(1)])).get(g(1))?.price).toBe(10)
    expect((await prices.get(g(100), [g(1)], g(201))).get(g(1))?.price).toBe(8)
    expect((await prices.get(g(100), [g(1)], g(999))).get(g(1))?.price).toBe(10)
  })
})

describe('заявка по выбранному соглашению', () => {
  function deps(): SubmitDeps & { orders: ReturnType<typeof createOrderStore> } {
    const d = db()
    const store = createCatalogStore(d)
    store.saveCatalog([], [item(1)])
    const clients = createClientStore(d)
    clients.save([client()])
    return {
      store, clients, orders: createOrderStore(d),
      b24: { createDeal: vi.fn(async () => 501) } as never,
      schedules: vi.fn(async () => []),
      prices: vi.fn(async (_c: string, items: string[]) => new Map(items.map(i => [i, { itemGuid: i, priceTypeGuid: g(31), price: 8, currency: 'BYN', vatRate: 20, changedAt: at, deleted: false }]))),
      now: () => new Date('2026-10-12T10:00:00Z'),
    }
  }
  const input = { requestId: '11111111-1111-4111-8111-111111111111', lines: [{ guid: g(1), qty: 1 }], addressGuid: g(300), comment: '' }

  it('выбрано второе соглашение — заявка с ним; чужое — с основным', async () => {
    const a = deps()
    expect((await submitOrder({ companyId: 7, contactId: 5 }, { status: 'ok', clientGuid: g(100), contractGuid: g(201) }, input, a)).ok).toBe(true)
    expect(a.orders.get(input.requestId)?.contract_guid).toBe(g(201))
    const b = deps()
    await submitOrder({ companyId: 7, contactId: 5 }, { status: 'ok', clientGuid: g(100), contractGuid: g(999) }, input, b)
    expect(b.orders.get(input.requestId)?.contract_guid).toBe(g(200))
  })
})
