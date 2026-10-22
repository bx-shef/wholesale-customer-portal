/**
 * Спецификация 1С, клиент ЛК и мок — одно и то же (docs/onec-contract.md §6): тест краснеет,
 * если в одном из четырёх мест появился, пропал или поменял HTTP-метод хоть один вызов.
 * Формы запросов и ответов держат общие схемы `shared/onec/schemas.ts` и контрактные тесты.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createMockState } from '../server/mocks/onec/mock'
import { mockFetch } from '../server/mocks/onec/fetch'
import { OnecClient } from '../server/services/onec'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const norm = (path: string) => path.replace(/\$\{[^}]+\}|\{[^}]+\}/g, '{guid}')
const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort()

const fromDoc = sorted([...read('docs/onec-contract.md').matchAll(/^\| 2\.\d+ \| `(GET|POST) ([^`]+)` \|/gm)].map(m => `${m[1]} ${norm(m[2]!)}`))
const fromClient = sorted([...read('server/services/onec.ts').matchAll(/this\.request\('(GET|POST)', [`']([^`']+)[`']/g)].map(m => `${m[1]} ${norm(m[2]!)}`))
const mockSrc = read('server/mocks/onec/mock.ts')
const fromMock = sorted([
  ...[...mockSrc.matchAll(/method === '(GET|POST)' && path === '([^']+)'/g)].map(m => `${m[1]} ${m[2]}`),
  ...(/method === 'GET' && clientMatch/.test(mockSrc) ? ['GET /client/{guid}'] : []),
  ...(/method === 'GET' && imageMatch/.test(mockSrc) && /\\\/image\\\/\(\[\^\/\]\+\)\$/.test(mockSrc) ? ['GET /image/{guid}'] : []),
])
const fromOpenApi = sorted([...read('contracts/onec.openapi.yaml').matchAll(/^ {2}(\/\S+):\n {4}(get|post):/gm)].map(m => `${m[2]!.toUpperCase()} ${norm(m[1]!)}`))

describe('1С: спецификация = клиент ЛК = мок = OpenAPI', () => {
  it('десять методов, одинаковые во всех четырёх местах', () => {
    expect(fromDoc).toHaveLength(10)
    expect(fromClient).toEqual(fromDoc)
    expect(fromMock).toEqual(fromDoc)
    expect(fromOpenApi).toEqual(fromDoc)
  })

  it('мок разбирает тела теми же схемами, что шлёт клиент', () => {
    for (const schema of ['OrderRequest.safeParse(req.body)', 'ListQuery.safeParse(req.query)']) expect(mockSrc).toContain(schema)
    expect(read('server/services/onec.ts')).toContain('OrderRequest.parse(input)')
  })

  it('каждый вызов клиента ЛК мок принимает, и ответ проходит схему клиента', async () => {
    const state = createMockState('parity')
    const c = new OnecClient({ baseUrl: 'http://mock.local/mock-1c', token: state.token, fetch: mockFetch(state), retries: 0 })
    const clients = await c.clients({ pageSize: 5 })
    const client = clients.items.find(x => x.contract)!
    expect((await c.clientByGuid(client.guid))?.guid).toBe(client.guid)
    expect(await c.clientByGuid('00000000-0000-4000-8000-000000000000')).toBeNull()
    const catalog = await c.catalog({ pageSize: 500 })
    const ref = catalog.items.flatMap(i => i.images)[0]
    if (ref) await c.image(ref.id)
    const prices = (await c.prices({ pageSize: 500 })).items.filter(p => p.priceTypeGuid === client.contract!.priceTypeGuid)
    await c.stock({ pageSize: 5 })
    const order = await c.createOrder({
      externalId: 'parity-1', clientGuid: client.guid, contractGuid: client.contract!.guid,
      deliveryAddressGuid: client.deliveryAddresses[0]!.guid, deliveryDate: '2026-10-20',
      items: [{ itemGuid: prices[0]!.itemGuid, qty: 1, price: prices[0]!.price }],
    })
    expect(order.items).toHaveLength(1)
    const status = await c.orderStatus({ pageSize: 5 })
    expect(status.items.map(o => o.orderGuid)).toContain(order.orderGuid)
    const schedule = await c.deliverySchedule()
    expect(schedule.items.map(s => s.regionGuid)).toContain(client.region!.guid)
    const trips = await c.trips({ pageSize: 50 })
    expect(trips.items.length).toBeGreaterThan(0)
  })
})
