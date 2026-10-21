import { describe, expect, it } from 'vitest'
import { ODataClient } from '../server/services/onecOdata'
import { addressGuid } from '../server/services/onecOdataClients'
import { createOdataOrder, orderBody, orderMarker, orderStatusOf, orderStatusRow, readOrderStatuses, testOrderGuid } from '../server/services/onecOdataOrders'
import { OrderRequest, OrderStatusRow } from '../shared/onec/schemas'

const G = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const PARTNER = G(1)
const ADDR = addressGuid(PARTNER, G(60), 'Минск|ул. Ленина, 1')
const req = (over: object = {}) => OrderRequest.parse({ externalId: '123', clientGuid: PARTNER, contractGuid: G(3), deliveryAddressGuid: ADDR, deliveryDate: '2026-10-25', comment: 'к обеду', items: [{ itemGuid: G(10), qty: 3, price: 12.5 }], ...over })

function onec(over: { existing?: object[], agreementPartner?: string, agreementStatus?: string, items?: string[] } = {}) {
  const calls: Array<{ method: string, url: string, body?: unknown, headers?: Record<string, string> }> = []
  const fetch: typeof globalThis.fetch = async (u, init) => {
    const url = decodeURIComponent(String(u))
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: init?.headers as Record<string, string> })
    const set = /standard\.odata\/([^?(]+)/.exec(url)![1]!
    if (method === 'POST') return Response.json({ Ref_Key: G(77), Number: 'ЗК-0001' }, { status: 201 })
    const data: Record<string, unknown[]> = {
      Document_ЗаказКлиента: over.existing ?? [],
      Catalog_СоглашенияСКлиентами: [{ Ref_Key: G(3), Статус: over.agreementStatus ?? 'Действует', Партнер_Key: over.agreementPartner ?? PARTNER, Валюта_Key: G(40), Договор_Key: G(4), Организация_Key: G(5), ВидЦен_Key: G(30) }],
      Catalog_Контрагенты: [{ Ref_Key: G(2), DeletionMark: true }, { Ref_Key: G(6) }],
      Catalog_Склады: [{ Ref_Key: G(50), Description: 'Основной склад' }],
      Catalog_Партнеры: [{ Ref_Key: PARTNER, ЗонаДоставки_Key: G(51) }],
      Catalog_Партнеры_КонтактнаяИнформация: [{ Ref_Key: PARTNER, LineNumber: '1', Тип: 'Адрес', Вид_Key: G(60), Город: 'Минск', Представление: 'ул. Ленина, 1' }],
      Catalog_Номенклатура: (over.items ?? [G(10)]).map(g => ({ Ref_Key: g, СтавкаНДС_Key: G(90) })),
    }
    return Response.json({ value: data[set] ?? [] })
  }
  return { calls, client: new ODataClient({ baseUrl: 'https://x/b/odata/standard.odata', auth: { kind: 'bearer', token: 't' }, fetch }) }
}
const opts = { warehouseNames: ['Основной склад'], enabled: true, now: new Date('2026-10-21T09:00:00Z') }

describe('заказ по OData: тело документа', () => {
  it('маркер заявки, ссылки, строки, дата по Минску; пустые ссылки не уходят', () => {
    const b = orderBody(req(), { agreement: { Ref_Key: G(3), Договор_Key: G(4), Организация_Key: '00000000-0000-0000-0000-000000000000', ВидЦен_Key: G(30) }, counterparty: G(6), warehouse: G(50), zone: null, address: 'ул. Ленина, 1', vat: new Map([[G(10), G(90)]]) }, opts.now)
    expect(b).toMatchObject({ Date: '2026-10-21T12:00:00', Партнер_Key: PARTNER, Контрагент_Key: G(6), Соглашение_Key: G(3), Склад_Key: G(50), НомерПоДаннымКлиента: 'ЛК-123', ДатаОтгрузки: '2026-10-25T00:00:00', АдресДоставки: 'ул. Ленина, 1', ХозяйственнаяОперация: 'РеализацияКлиенту', ЦенаВключаетНДС: true })
    expect(b).not.toHaveProperty('Организация_Key')
    expect(b).not.toHaveProperty('ЗонаДоставки_Key')
    expect((b.Товары as object[])[0]).toMatchObject({ LineNumber: '1', Номенклатура_Key: G(10), Количество: 3, Цена: 12.5, Сумма: 37.5, СтавкаНДС_Key: G(90), ВидЦены_Key: G(30) })
  })

  it('маркер — только безопасные символы: кавычка в фильтр не попадёт', () => {
    expect(orderMarker('deal-15')).toBe('ЛК-deal-15')
    expect(orderMarker('1'.repeat(37))).toHaveLength(40)
    expect(() => orderMarker('1'.repeat(38))).toThrow(expect.objectContaining({ kind: 'contract' }))
    expect(() => orderMarker("1' or 1 eq 1")).toThrow(expect.objectContaining({ kind: 'contract' }))
  })
})

describe('заказ по OData: запись', () => {
  it('пишет документ непроведённым: не проводит, резерв — количество (резервирует 1С при проведении)', async () => {
    const t = onec()
    const r = await createOdataOrder(t.client, req(), opts)
    expect(r).toEqual({ orderGuid: G(77), number: 'ЗК-0001', status: 'new', items: [{ itemGuid: G(10), price: 12.5, reserved: 3 }] })
    const post = t.calls.find(c => c.method === 'POST')!
    expect(post.body).toMatchObject({ Контрагент_Key: G(6), ЗонаДоставки_Key: G(51), Склад_Key: G(50) })
    expect(post.url).toBe('https://x/b/odata/standard.odata/Document_ЗаказКлиента?$format=json')
    expect(post.headers).toMatchObject({ 'content-type': 'application/json', 'authorization': 'Bearer t' })
    expect(t.calls.filter(c => c.method === 'POST')).toHaveLength(1)
  })

  it('повтор находит документ (самый ранний по номеру), а не пишет второй; GUID в любом регистре', async () => {
    const again = onec({ existing: [{ Ref_Key: G(77), Number: 'ЗК-0001', Posted: true, Статус: 'КОбеспечению', Партнер_Key: PARTNER.toUpperCase() }] })
    expect(await createOdataOrder(again.client, req(), opts)).toMatchObject({ orderGuid: G(77), status: 'confirmed' })
    expect(again.calls.some(c => c.method === 'POST')).toBe(false)
    expect(again.calls[0]!.url).toContain("НомерПоДаннымКлиента eq 'ЛК-123'")
    expect(again.calls[0]!.url).toContain('$orderby=Number')
  })

  it('запись выключена — отказ 501 без записи; тестовый заказ при этом работает', async () => {
    const t = onec()
    await expect(createOdataOrder(t.client, req(), { ...opts, enabled: false })).rejects.toMatchObject({ status: 501 })
    expect(t.calls).toHaveLength(0)
    expect(await createOdataOrder(onec().client, req({ test: true }), { ...opts, enabled: false })).toMatchObject({ number: 'ТЕСТ-123' })
  })

  it('соглашение не действует или чьё-то в верхнем регистре своё', async () => {
    await expect(createOdataOrder(onec({ agreementStatus: 'Закрыто' }).client, req(), opts)).rejects.toMatchObject({ kind: 'contract' })
    expect((await createOdataOrder(onec({ agreementPartner: PARTNER.toUpperCase() }).client, req(), opts)).orderGuid).toBe(G(77))
  })

  it('НДС — пачками по 40 товаров', async () => {
    const items = Array.from({ length: 41 }, (_, i) => G(100 + i))
    const t = onec({ items })
    await createOdataOrder(t.client, req({ items: items.map(g => ({ itemGuid: g, qty: 1, price: 1 })) }), opts)
    expect(t.calls.filter(c => c.url.includes('Catalog_Номенклатура'))).toHaveLength(2)
  })

  it('чужой заказ с тем же номером заявки, чужое соглашение, нет адреса или товара — отказ без записи', async () => {
    const foreign = onec({ existing: [{ Ref_Key: G(77), Партнер_Key: G(9) }] })
    await expect(createOdataOrder(foreign.client, req(), opts)).rejects.toMatchObject({ status: 409 })
    for (const [t, input] of [[onec({ agreementPartner: G(9) }), req()], [onec(), req({ deliveryAddressGuid: G(99) })], [onec({ items: [] }), req()]] as const) {
      await expect(createOdataOrder(t.client, input, opts)).rejects.toMatchObject({ kind: 'contract' })
      expect(t.calls.some(c => c.method === 'POST')).toBe(false)
    }
  })

  it('тестовый заказ стенда: всё проверяет, документ не создаёт и существующий не ищет', async () => {
    const t = onec({ existing: [{ Ref_Key: G(77), Партнер_Key: PARTNER }] })
    const r = await createOdataOrder(t.client, req({ test: true }), opts)
    expect(r).toMatchObject({ orderGuid: testOrderGuid('123'), number: 'ТЕСТ-123' })
    expect(t.calls.some(c => c.method === 'POST')).toBe(false)
    expect(t.calls.filter(c => c.url.includes('Document_ЗаказКлиента'))).toHaveLength(0)
    await expect(createOdataOrder(onec({ agreementPartner: G(9) }).client, req({ test: true }), opts)).rejects.toMatchObject({ kind: 'contract' })
  })
})

describe('заказ по OData: статусы', () => {
  it('статус по документу', () => {
    expect(orderStatusOf({ Ref_Key: 'x', DeletionMark: true, Posted: true, Статус: 'Закрыт' })).toBe('cancelled')
    expect(orderStatusOf({ Ref_Key: 'x', DeletionMark: true, Posted: false })).toBe('cancelled')
    expect(orderStatusOf({ Ref_Key: 'x', Posted: false, Статус: 'КОтгрузке' })).toBe('new')
    expect(orderStatusOf({ Ref_Key: 'x', Posted: true, Статус: 'НеСогласован' })).toBe('new')
    expect(orderStatusOf({ Ref_Key: 'x', Posted: true, Статус: 'КОбеспечению' })).toBe('confirmed')
    expect(orderStatusOf({ Ref_Key: 'x', Posted: true, Статус: 'КОтгрузке' })).toBe('assembled')
    expect(orderStatusOf({ Ref_Key: 'x', Posted: true, Статус: 'Закрыт' })).toBe('shipped')
  })

  it('строка контракта только для заказов ЛК; дата отгрузки 0001 — нет', () => {
    expect(orderStatusRow({ Ref_Key: G(77), НомерПоДаннымКлиента: 'чужой' }, '2026-10-21T00:00:00+03:00')).toBeNull()
    const r = orderStatusRow({ Ref_Key: G(77).toUpperCase(), Number: 'ЗК-1', НомерПоДаннымКлиента: 'ЛК-55', ДатаОтгрузки: '0001-01-01T00:00:00' }, '2026-10-21T00:00:00+03:00')!
    expect(r).toMatchObject({ orderGuid: G(77), externalId: '55', shipmentDate: null, tripGuid: null })
    expect(OrderStatusRow.safeParse(r).success).toBe(true)
  })

  it('readOrderStatuses: окно по дате и маркер в фильтре', async () => {
    const t = onec({ existing: [{ Ref_Key: G(77), Number: 'ЗК-1', НомерПоДаннымКлиента: 'ЛК-55', DataVersion: 'v1', Posted: true, Статус: 'КОтгрузке', ДатаОтгрузки: '2026-10-25T00:00:00' }] })
    const rows = await readOrderStatuses(t.client, new Date('2026-10-21T09:00:00Z'))
    expect(rows).toEqual([{ row: expect.objectContaining({ status: 'assembled', shipmentDate: '2026-10-25' }), version: 'v1|assembled|2026-10-25' }])
    expect(t.calls[0]!.url).toContain("Date ge datetime'2026-07-23T12:00:00' and startswith(НомерПоДаннымКлиента, 'ЛК-')")
  })
})

describe('OdataOnec: заказы', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const { migrate } = await import('../server/db/sqlite')
  const { OdataOnec } = await import('../server/services/onecOdataSource')
  const { sqliteVersionStore } = await import('../server/utils/odataVersions')
  it('createOrder берёт склад из настроек, orderStatus — страница с моментом по версии', async () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const t = onec({ existing: [] })
    const api = new OdataOnec(t.client, sqliteVersionStore(db), { warehouseNames: ['Основной склад'], ordersEnabled: true, ttlMs: 0, now: () => new Date('2026-10-21T09:00:00Z') })
    expect((await api.createOrder(req())).orderGuid).toBe(G(77))
    const off = new OdataOnec(onec().client, sqliteVersionStore(db), { warehouseNames: ['Основной склад'] })
    await expect(off.createOrder(req())).rejects.toMatchObject({ status: 501 })
    const s = onec({ existing: [{ Ref_Key: G(77), Number: 'ЗК-1', НомерПоДаннымКлиента: 'ЛК-55', DataVersion: 'v1', Posted: true, Статус: 'Закрыт' }] })
    const api2 = new OdataOnec(s.client, sqliteVersionStore(db), { ttlMs: 0, now: () => new Date('2026-10-21T09:00:00Z') })
    const page = await api2.orderStatus({})
    expect(page.items).toEqual([expect.objectContaining({ orderGuid: G(77), status: 'shipped', changedAt: '2026-10-21T09:00:00.000Z' })])
  })
})

describe('ODataClient.send', () => {
  const mk = (res: Response, seen: { url?: string, init?: RequestInit } = {}) => new ODataClient({ baseUrl: 'https://x/b/odata/standard.odata/', auth: { kind: 'basic', login: 'u', password: 'p' }, fetch: async (u, i) => { seen.url = String(u); seen.init = i; return res } })
  it('адрес с параметрами, тело JSON, пустой ответ — null, не JSON — contract, ошибка — текст 1С', async () => {
    const seen: { url?: string, init?: RequestInit } = {}
    expect(await mk(new Response('', { status: 200 }), seen).send('POST', 'D(guid\'1\')/Post?A=1', 'D', { x: 1 })).toBeNull()
    expect(seen.url).toBe("https://x/b/odata/standard.odata/D(guid'1')/Post?A=1&$format=json")
    expect(seen.init?.body).toBe('{"x":1}')
    await expect(mk(new Response('oops', { status: 200 })).send('POST', 'D', 'D')).rejects.toMatchObject({ kind: 'contract' })
    await expect(mk(new Response('{"odata.error":{"message":{"value":"нет  прав"}}}', { status: 403 })).send('POST', 'D', 'D')).rejects.toThrow('HTTP 403 — нет прав')
  })
})
