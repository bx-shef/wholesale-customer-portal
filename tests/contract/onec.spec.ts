/**
 * Контрактные тесты сервиса 1С (docs/onec-contract.md). Одни и те же проверки идут:
 * - в CI — против мока в процессе (по умолчанию);
 * - на приёмке — против тестовой базы 1С:
 *     ONEC_CONTRACT_URL=https://1c-test.example.by/hs/lk ONEC_CONTRACT_TOKEN=… pnpm test:contract
 *   Создание заказа на реальной базе — только с ONEC_CONTRACT_ALLOW_ORDER=1 (это запись в 1С).
 *
 * Тесты ходят через клиент ЛК (`server/services/onec.ts`): что прошло здесь, то ЛК и прочитает.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { createMockState } from '../../server/mocks/onec/mock'
import { mockFetch } from '../../server/mocks/onec/fetch'
import { collectPages, OnecClient, OnecError } from '../../server/services/onec'
import { ErrorBody, type ClientT } from '../../shared/onec/schemas'

const remoteUrl = process.env.ONEC_CONTRACT_URL?.trim()
// Без токена тесты 401 проверяли бы пустой Bearer, а остальные упали бы невнятно.
if (remoteUrl && !process.env.ONEC_CONTRACT_TOKEN?.trim()) throw new Error('ONEC_CONTRACT_TOKEN is required with ONEC_CONTRACT_URL')
const target = remoteUrl
  ? { baseUrl: remoteUrl, token: process.env.ONEC_CONTRACT_TOKEN ?? '', fetch, allowOrder: process.env.ONEC_CONTRACT_ALLOW_ORDER === '1' }
  : (() => {
      const state = createMockState('contract-token')
      return { baseUrl: 'http://mock.local/mock-1c', token: state.token, fetch: mockFetch(state), allowOrder: true }
    })()

const client = new OnecClient({ baseUrl: target.baseUrl, token: target.token, fetch: target.fetch, retries: 0 })
const raw = (path: string, init: RequestInit = {}) => target.fetch(new URL(target.baseUrl.replace(/\/+$/, '') + path), init)

async function expectError(promise: Promise<unknown>, status: number) {
  const error = await promise.then(() => null, (e: unknown) => e)
  expect(error).toBeInstanceOf(OnecError)
  expect((error as OnecError).status).toBe(status)
}

describe(`контракт 1С — ${remoteUrl ? remoteUrl : 'мок'}`, () => {
  let clients: ClientT[] = []

  beforeAll(async () => {
    clients = await collectPages(page => client.clients({ page }))
  })

  describe('доступ и ошибки', () => {
    it('без токена и с чужим токеном — 401 с телом ошибки', async () => {
      for (const headers of [{}, { authorization: 'Bearer wrong-token' }]) {
        const res = await raw('/clients', { headers })
        expect(res.status).toBe(401)
        expect(ErrorBody.safeParse(await res.json()).success).toBe(true)
      }
    })

    it('неизвестная картинка — 404 с телом ошибки', async () => {
      await expectError(client.image('no-such-image'), 404)
    })
  })

  describe('GET /clients', () => {
    it('есть хотя бы один клиент, и у него есть договор', async () => {
      expect(clients.length).toBeGreaterThan(0)
      const withContract = clients.find(c => c.contract && !c.deleted)
      expect(withContract, 'договор приходит внутри клиента — поле contract').toBeTruthy()
    })

    it('страницы по 2 дают тот же набор без повторов, последняя — nextPage: null', async () => {
      const paged = await collectPages(page => client.clients({ page, pageSize: 2 }))
      expect(paged.map(c => c.guid).sort()).toEqual(clients.map(c => c.guid).sort())
      expect(new Set(paged.map(c => c.guid)).size).toBe(paged.length)
    })

    it('changedSince отдаёт изменённое начиная с момента — граница включительно', async () => {
      expect(new Set(clients.map(c => c.changedAt)).size, 'нужны клиенты хотя бы с двумя разными changedAt').toBeGreaterThan(1)
      const sorted = [...clients].sort((a, b) => a.changedAt.localeCompare(b.changedAt))
      const pivot = sorted[Math.floor(sorted.length / 2)]!.changedAt
      const after = await collectPages(page => client.clients({ page, changedSince: pivot }))
      expect(after.every(c => Date.parse(c.changedAt) >= Date.parse(pivot))).toBe(true)
      expect(after.map(c => c.guid)).toContain(sorted.find(c => c.changedAt === pivot)!.guid)
      const future = await client.clients({ changedSince: '2999-01-01T00:00:00Z' })
      expect(future).toEqual({ items: [], nextPage: null })
    })

    it('pageSize больше 500 — 400', async () => {
      await expectError(client.clients({ pageSize: 501 }), 400)
    })
  })

  describe('GET /catalog и GET /prices', () => {
    it('первая страница несёт разделы, товары ссылаются на них', async () => {
      const first = await client.catalog({ pageSize: 50 })
      expect(first.sections.length).toBeGreaterThan(0)
      const sectionGuids = new Set(first.sections.map(s => s.guid))
      expect(first.items.every(i => sectionGuids.has(i.sectionGuid))).toBe(true)
      for (const s of first.sections) if (s.parentGuid) expect(sectionGuids.has(s.parentGuid)).toBe(true)
    })

    it('прайс содержит вид цен из договора клиента, цены — на товары каталога', async () => {
      const buyer = clients.find(c => c.contract && !c.deleted)!
      const rows = await collectPages(page => client.prices({ page }))
      const own = rows.filter(r => r.priceTypeGuid.toLowerCase() === buyer.contract!.priceTypeGuid.toLowerCase())
      expect(own.length).toBeGreaterThan(0)
      const items = new Set((await collectPages(page => client.catalog({ page }))).map(i => i.guid.toLowerCase()))
      expect(own.every(r => items.has(r.itemGuid.toLowerCase()))).toBe(true)
      expect(new Set(rows.map(r => `${r.priceTypeGuid}|${r.itemGuid}`.toLowerCase())).size, 'пара «вид цен × товар» — одна строка').toBe(rows.length)
    })

    it('прайс по changedSince из будущего — пусто', async () => {
      expect(await client.prices({ changedSince: '2999-01-01T00:00:00Z' })).toEqual({ items: [], nextPage: null })
    })
  })

  describe('GET /stock', () => {
    it('свободный остаток не отрицателен и ссылается на склад', async () => {
      const stock = await client.stock({ pageSize: 100 })
      expect(stock.items.length).toBeGreaterThan(0)
      expect(stock.items.every(s => s.available >= 0 && s.warehouseName.length > 0)).toBe(true)
    })
  })

  describe('POST /order — проверка входа (ничего не пишет)', () => {
    it('заказ без позиций отвергается', async () => {
      const res = await raw('/order', {
        method: 'POST',
        headers: { 'authorization': `Bearer ${target.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ externalId: 'x', clientGuid: clients[0]!.guid, items: [] }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe.skipIf(!target.allowOrder)('POST /order и GET /orders/status', () => {
    it('заказ идемпотентен по externalId и виден в статусах', async () => {
      const buyer = clients.find(c => c.contract && !c.deleted && c.deliveryAddresses.length > 0)!
      const price = (await collectPages(page => client.prices({ page }))).find(p => p.priceTypeGuid.toLowerCase() === buyer.contract!.priceTypeGuid.toLowerCase())!
      const item = (await collectPages(page => client.catalog({ page }))).find(i => i.guid.toLowerCase() === price.itemGuid.toLowerCase())!
      const externalId = `contract-test-${Date.now()}`
      const order = {
        externalId,
        clientGuid: buyer.guid,
        contractGuid: buyer.contract!.guid,
        deliveryAddressGuid: buyer.deliveryAddresses[0]!.guid,
        deliveryDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
        items: [{ itemGuid: item.guid, qty: item.minQty, price: price.price }],
      }
      const first = await client.createOrder(order)
      const again = await client.createOrder(order)
      expect(again.orderGuid).toBe(first.orderGuid)
      expect(again.number).toBe(first.number)
      // Факт по строке: цена прайса договора и резерв — это и есть сверка перед заказом (§2.6).
      expect(first.items.map(f => f.itemGuid.toLowerCase())).toEqual([item.guid.toLowerCase()])
      expect(first.items[0]!.reserved).toBeLessThanOrEqual(item.minQty)

      const statuses = await collectPages(page => client.orderStatus({ page }))
      expect(statuses.find(s => s.externalId === externalId)?.orderGuid).toBe(first.orderGuid)

      // Тот же externalId от другого клиента — 409, а не чужой заказ.
      const other = clients.find(c => c.guid !== buyer.guid && c.contract && !c.deleted && c.deliveryAddresses.length > 0)
      if (other) {
        await expectError(client.createOrder({ ...order, clientGuid: other.guid, contractGuid: other.contract!.guid, deliveryAddressGuid: other.deliveryAddresses[0]!.guid }), 409)
      }
    })

  })
})
