import { describe, expect, it, vi } from 'vitest'
import { ODataClient } from '../server/services/onecOdata'
import { addressGuid } from '../server/services/onecOdataClients'
import { aggregateTrips, CLOSED_SKIP_DAYS, createOdataOrder, orderBody, orderMarker, ORDER_STATE_STATUS, orderStatusOf, orderStatusRow, readDeliveryConfirmed, readOrderStatuses, testOrderGuid } from '../server/services/onecOdataOrders'
import { OrderRequest, OrderStatusRow } from '../shared/onec/schemas'

const G = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const PARTNER = G(1)
const ADDR = addressGuid(PARTNER, G(60), 'Минск|ул. Ленина, 1')
const req = (over: object = {}) => OrderRequest.parse({ externalId: '123', clientGuid: PARTNER, contractGuid: G(3), deliveryAddressGuid: ADDR, deliveryDate: '2026-10-25', comment: 'к обеду', items: [{ itemGuid: G(10), qty: 3, price: 12.5 }], ...over })

function onec(over: { existing?: object[], agreementPartner?: string, agreementStatus?: string, items?: string[], extra?: Record<string, unknown[]> } = {}) {
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
      ...over.extra,
    }
    return Response.json({ value: data[set] ?? [] })
  }
  return { calls, client: new ODataClient({ baseUrl: 'https://x/b/odata/standard.odata', auth: { kind: 'bearer', token: 't' }, fetch }) }
}
const opts = { warehouseNames: ['Основной склад'], enabled: true, now: new Date('2026-10-21T09:00:00Z') }

describe('заказ по OData: тело документа', () => {
  it('цена без НДС, НДС с суммы строки, итог документа с НДС', () => {
    const r = req()
    r.items = [{ itemGuid: G(10), qty: 3, price: 1.23, vatRate: 20 }, { itemGuid: G(11), qty: 1, price: 10, vatRate: 0 }]
    const b = orderBody(r, { agreement: { Ref_Key: G(3) }, counterparty: G(6), warehouse: G(50), zone: null, address: 'a', vat: new Map() }, opts.now)
    expect(b.ЦенаВключаетНДС).toBe(false)
    expect((b.Товары as object[])[0]).toMatchObject({ Цена: 1.23, Сумма: 3.69, СуммаНДС: 0.74, СуммаСНДС: 4.43 })
    expect(b.СуммаДокумента).toBe(14.43)
    // Ставки нет — НДС и итоги не заполняем (не считаем по нулю).
    r.items = [{ itemGuid: G(10), qty: 3, price: 1.23 }]
    const n = orderBody(r, { agreement: { Ref_Key: G(3) }, counterparty: G(6), warehouse: G(50), zone: null, address: 'a', vat: new Map() }, opts.now)
    expect(n.СуммаДокумента).toBeUndefined()
    expect((n.Товары as Record<string, unknown>[])[0]).toMatchObject({ Цена: 1.23, Сумма: 3.69 })
    expect((n.Товары as Record<string, unknown>[])[0]).not.toHaveProperty('СуммаНДС')
  })

  it('маркер заявки, ссылки, строки, дата по Минску; пустые ссылки не уходят', () => {
    const b = orderBody(req(), { agreement: { Ref_Key: G(3), Договор_Key: G(4), Организация_Key: '00000000-0000-0000-0000-000000000000', ВидЦен_Key: G(30) }, counterparty: G(6), warehouse: G(50), zone: null, address: 'ул. Ленина, 1', vat: new Map([[G(10), G(90)]]) }, opts.now)
    expect(b).toMatchObject({ Date: '2026-10-21T12:00:00', Партнер_Key: PARTNER, Контрагент_Key: G(6), Соглашение_Key: G(3), Склад_Key: G(50), НомерПоДаннымКлиента: 'ЛК-123', ДатаОтгрузки: '2026-10-25T00:00:00', АдресДоставки: 'ул. Ленина, 1', ХозяйственнаяОперация: 'РеализацияКлиенту', ЦенаВключаетНДС: false })
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

  it('НДС — пачками по длине адреса (IIS режет строку длиннее ~2 КБ)', async () => {
    const items = Array.from({ length: 41 }, (_, i) => G(100 + i))
    const t = onec({ items })
    await createOdataOrder(t.client, req({ items: items.map(g => ({ itemGuid: g, qty: 1, price: 1 })) }), opts)
    const calls = t.calls.filter(c => c.url.includes('Catalog_Номенклатура'))
    expect(calls.length).toBeGreaterThan(1)
    for (const c of calls) expect(encodeURI(c.url).split('?')[1]!.length).toBeLessThan(2048)
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

  it('статус по состоянию заказа из регистра — главнее статуса документа', () => {
    const doc = { Ref_Key: 'x', Posted: true, Статус: 'КОбеспечению' }
    const want: Record<string, string> = {
      ОжидаетсяСогласование: 'new', НеСогласован: 'new',
      ОжидаетсяПредоплатаДоОбеспечения: 'confirmed', ОжидаетсяОбеспечение: 'confirmed', ОжидаетсяПредоплатаДоОтгрузки: 'confirmed',
      ГотовКОтгрузке: 'assembled',
      ВПроцессеОтгрузки: 'assembled', ОжидаетсяОплатаПослеОтгрузки: 'shipped', ГотовКЗакрытию: 'shipped', Закрыт: 'shipped',
    }
    for (const [state, status] of Object.entries(want)) expect(orderStatusOf(doc, state), state).toBe(status)
    expect(Object.keys(ORDER_STATE_STATUS).sort()).toEqual(Object.keys(want).sort())
    // Незнакомое или пустое состояние — откат на статус документа.
    expect(orderStatusOf(doc, 'Неведомое')).toBe('confirmed')
    expect(orderStatusOf(doc, '')).toBe('confirmed')
    // Ключи прототипа объекта — не состояние.
    for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(orderStatusOf(doc, k), k).toBe('confirmed')
    expect(orderStatusOf({ ...doc, Статус: 'КОтгрузке' })).toBe('assembled')
    // Пометка удаления и непроведённый — главнее состояния.
    expect(orderStatusOf({ ...doc, DeletionMark: true }, 'Закрыт')).toBe('cancelled')
    expect(orderStatusOf({ ...doc, Posted: false }, 'Закрыт')).toBe('new')
  })

  it('readOrderStatuses: состояние из регистра в статусе и версии; регистр — один раз; сбой — откат', async () => {
    const doc = { Ref_Key: G(77), Number: 'ЗК-1', НомерПоДаннымКлиента: 'ЛК-55', DataVersion: 'v1', Posted: true, Статус: 'КОбеспечению' }
    const t = onec({ existing: [doc], extra: { InformationRegister_СостоянияЗаказовКлиентов: [{ Заказ: G(77).toUpperCase(), Состояние: 'ОжидаетсяОплатаПослеОтгрузки' }] } })
    const rows = await readOrderStatuses(t.client, new Date('2026-10-21T09:00:00Z'))
    expect(rows).toEqual([{ row: expect.objectContaining({ status: 'shipped' }), version: 'v1|shipped||0' }])
    // «К выполнению» — сверка доставки берёт уже прочитанное состояние.
    const w = onec({ existing: [{ ...doc, Статус: 'КОтгрузке' }], extra: { InformationRegister_СостоянияЗаказовКлиентов: [{ Заказ: G(77), Состояние: 'ГотовКОтгрузке' }] } })
    await readOrderStatuses(w.client, new Date('2026-10-21T09:00:00Z'))
    expect(w.calls.filter(c => c.url.includes('СостоянияЗаказовКлиентов'))).toHaveLength(1)
    const f = onec({ existing: [doc] })
    const list = f.client.list.bind(f.client)
    f.client.list = (async (set: string, q: never) => {
      if (set.includes('СостоянияЗаказов')) throw new Error('HTTP 500')
      return list(set, q)
    }) as typeof f.client.list
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fb = await readOrderStatuses(f.client, new Date('2026-10-21T09:00:00Z'))
    expect(fb[0]!.row.status).toBe('confirmed')
    // Предупреждение есть, и в нём нет текста ошибки (адрес, фильтр, номер заказа).
    expect(warn).toHaveBeenCalledTimes(1)
    const msg = String(warn.mock.calls[0]![0])
    expect(msg).toContain('order states unavailable')
    expect(msg).not.toContain('HTTP 500')
    expect(msg).not.toContain('ЛК-55')
    warn.mockRestore()
  })

  it('регистр не читается для закрытых, непроведённых и удалённых документов', async () => {
    const base = { Number: 'ЗК', DataVersion: 'v', НомерПоДаннымКлиента: 'ЛК-1' }
    const t = onec({ existing: [
      { ...base, Ref_Key: G(1), Posted: true, Статус: 'Закрыт' },
      { ...base, Ref_Key: G(2), Posted: false, Статус: 'КОбеспечению' },
      { ...base, Ref_Key: G(3), Posted: true, DeletionMark: true, Статус: 'КОбеспечению' },
    ] })
    const rows = await readOrderStatuses(t.client, new Date('2026-10-21T09:00:00Z'))
    expect(rows.map(r => r.row.status)).toEqual(['shipped', 'new', 'cancelled'])
    expect(t.calls.filter(c => c.url.includes('СостоянияЗаказовКлиентов'))).toHaveLength(0)
    // Открытый проведённый — читается, и только он.
    const o = onec({ existing: [{ ...base, Ref_Key: G(4), Posted: true, Статус: 'КОбеспечению' }, { ...base, Ref_Key: G(1), Posted: true, Статус: 'Закрыт' }] })
    await readOrderStatuses(o.client, new Date('2026-10-21T09:00:00Z'))
    const reg = o.calls.filter(c => c.url.includes('СостоянияЗаказовКлиентов'))
    expect(reg).toHaveLength(1)
    expect(reg[0]!.url).toContain(G(4))
    expect(reg[0]!.url).not.toContain(G(1))
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
    expect(rows).toEqual([{ row: expect.objectContaining({ status: 'assembled', shipmentDate: '2026-10-25' }), version: 'v1|assembled|2026-10-25|0' }])
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

describe('«точно приедет»: четыре статуса (решение клиента 2026-10-27)', () => {
  const extra = (over: { state?: string, issue?: string, trip?: string } = {}) => ({
    InformationRegister_СостоянияЗаказовКлиентов: [{ Заказ: G(77), Состояние: over.state ?? 'ГотовКЗакрытию' }],
    Document_РасходныйОрдерНаТовары_ТоварыПоРаспоряжениям: [{ Ref_Key: G(80), Распоряжение: G(77) }],
    Document_РасходныйОрдерНаТовары: [{ Ref_Key: G(80), Статус: over.issue ?? 'КОтгрузке', Posted: true, ЗаданиеНаПеревозку_Key: G(81) }],
    Document_ЗаданиеНаПеревозку: [{ Ref_Key: G(81), Статус: over.trip ?? 'Закрыто' }],
  })
  it('все четыре — подтверждено; любое не то — нет', async () => {
    expect([...await readDeliveryConfirmed(onec({ extra: extra() }).client, [G(77)])]).toEqual([G(77)])
    for (const o of [{ state: 'ОжидаетсяОплата' }, { issue: 'КОтбору' }, { trip: 'Отправлено' }]) {
      expect((await readDeliveryConfirmed(onec({ extra: extra(o) }).client, [G(77)])).size, JSON.stringify(o)).toBe(0)
    }
  })
  it('в статусах — только для заказа «К выполнению»', async () => {
    const doc = { Ref_Key: G(77), Number: 'ЗК-1', НомерПоДаннымКлиента: 'ЛК-55', DataVersion: 'v1', Posted: true }
    const yes = await readOrderStatuses(onec({ existing: [{ ...doc, Статус: 'КОтгрузке' }], extra: extra() }).client, new Date('2026-10-21T09:00:00Z'))
    expect(yes[0]!.row.deliveryConfirmed).toBe(true)
    // Документ «К обеспечению», но состояние «Готов к закрытию» — тоже кандидат.
    const byState = await readOrderStatuses(onec({ existing: [{ ...doc, Статус: 'КОбеспечению' }], extra: extra() }).client, new Date('2026-10-21T09:00:00Z'))
    expect(byState[0]!.row.deliveryConfirmed).toBe(true)
    const no = await readOrderStatuses(onec({ existing: [{ ...doc, Статус: 'КОбеспечению' }], extra: extra({ state: 'ОжидаетсяОплатаПослеОтгрузки' }) }).client, new Date('2026-10-21T09:00:00Z'))
    expect(no[0]!.row.deliveryConfirmed).toBe(false)
  })
  it('регистр не прочитался — сверку пропускаем, регистр второй раз не читаем', async () => {
    const t = onec({ existing: [{ Ref_Key: G(77), Number: 'ЗК-1', НомерПоДаннымКлиента: 'ЛК-55', DataVersion: 'v1', Posted: true, Статус: 'КОтгрузке' }], extra: extra() })
    const list = t.client.list.bind(t.client)
    let reg = 0
    t.client.list = (async (set: string, q: never) => {
      if (set.includes('СостоянияЗаказов')) { reg++; throw new Error('HTTP 500') }
      return list(set, q)
    }) as typeof t.client.list
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rows = await readOrderStatuses(t.client, new Date('2026-10-21T09:00:00Z'))
    warn.mockRestore()
    expect(reg).toBe(1)
    expect(rows[0]!.row.deliveryConfirmed).toBe(false)
    // Задание «Закрыто» — доставлено и без регистра; цепочка прочитана один раз.
    expect(rows[0]!.row.status).toBe('delivered')
    expect(t.calls.filter(c => c.url.includes('ЗаданиеНаПеревозку?'))).toHaveLength(1)
  })
})

describe('статусы по 1С: задание на перевозку и отмена (ответы программиста 1С 2026-11-13)', () => {
  const doc = { Ref_Key: G(77), Number: 'ЗК-1', НомерПоДаннымКлиента: 'ЛК-55', DataVersion: 'v1', Posted: true, Статус: 'КОтгрузке', ДатаОтгрузки: '2026-10-25T00:00:00' }
  const chain = (trip: object | null, issue: object = {}) => ({
    Document_РасходныйОрдерНаТовары_ТоварыПоРаспоряжениям: [{ Ref_Key: G(80), Распоряжение: G(77) }],
    Document_РасходныйОрдерНаТовары: [{ Ref_Key: G(80), Статус: 'КОтбору', Posted: true, ЗаданиеНаПеревозку_Key: G(81), ...issue }],
    Document_ЗаданиеНаПеревозку: trip ? [{ Ref_Key: G(81), Date: '2026-10-27T08:00:00', ...trip }] : [],
  })
  const run = async (d: object, extra: Record<string, unknown[]>) => readOrderStatuses(onec({ existing: [d], extra }).client, new Date('2026-10-21T09:00:00Z'))

  it('«Отправлено» — shipped, дата отгрузки — дата задания; «Закрыто» — delivered', async () => {
    const sent = await run(doc, chain({ Статус: 'Отправлено' }))
    expect(sent[0]).toEqual({ row: expect.objectContaining({ status: 'shipped', shipmentDate: '2026-10-27' }), version: 'v1|shipped|2026-10-27|0' })
    const closed = await run(doc, chain({ Статус: 'Закрыто' }))
    expect(closed[0]!.row).toMatchObject({ status: 'delivered', shipmentDate: '2026-10-27' })
    // Смена статуса задания меняет версию при той же версии заказа.
    expect(closed[0]!.version).not.toBe(sent[0]!.version)
  })

  it('«Формируется», «К погрузке», удалённое задание, непроведённый ордер — статус по заказу', async () => {
    for (const [trip, issue] of [[{ Статус: 'Формируется' }, {}], [{ Статус: 'КПогрузке' }, {}], [{ Статус: 'Закрыто', DeletionMark: true }, {}], [{ Статус: 'Закрыто' }, { Posted: false }]] as const) {
      const r = await run(doc, chain(trip, issue))
      expect(r[0]!.row, JSON.stringify([trip, issue])).toMatchObject({ status: 'assembled', shipmentDate: '2026-10-25' })
    }
  })

  it('несколько заданий: одно «Отправлено» — частичная отгрузка, shipped с поздней датой', async () => {
    const extra = {
      Document_РасходныйОрдерНаТовары_ТоварыПоРаспоряжениям: [{ Ref_Key: G(80), Распоряжение: G(77) }, { Ref_Key: G(82), Распоряжение: G(77) }],
      Document_РасходныйОрдерНаТовары: [{ Ref_Key: G(80), Posted: true, ЗаданиеНаПеревозку_Key: G(81) }, { Ref_Key: G(82), Posted: true, ЗаданиеНаПеревозку_Key: G(83) }],
      Document_ЗаданиеНаПеревозку: [{ Ref_Key: G(81), Статус: 'Закрыто', Date: '2026-10-26T00:00:00' }, { Ref_Key: G(83), Статус: 'Отправлено', Date: '2026-10-28T00:00:00' }],
    }
    expect((await run(doc, extra))[0]!.row).toMatchObject({ status: 'shipped', shipmentDate: '2026-10-28' })
    const both = { ...extra, Document_ЗаданиеНаПеревозку: [{ Ref_Key: G(81), Статус: 'Закрыто', Date: '2026-10-29T00:00:00' }, { Ref_Key: G(83), Статус: 'Закрыто', Date: '2026-10-26T00:00:00' }] }
    expect((await run(doc, both))[0]!.row).toMatchObject({ status: 'delivered', shipmentDate: '2026-10-29' })
  })

  it('aggregateTrips: все закрыты — delivered; есть иное — shipped; только иное — нет', () => {
    const c = (date: string) => ({ status: 'delivered' as const, date })
    expect(aggregateTrips([c('2026-10-01'), c('2026-10-05')])).toEqual({ status: 'delivered', date: '2026-10-05' })
    expect(aggregateTrips([c('2026-10-05'), { status: 'other', date: '2026-10-09' }])).toEqual({ status: 'shipped', date: '2026-10-05' })
    expect(aggregateTrips([c('2026-10-01'), { status: 'shipped', date: '2026-10-03' }])).toEqual({ status: 'shipped', date: '2026-10-03' })
    expect(aggregateTrips([{ status: 'other', date: '2026-10-09' }])).toBeUndefined()
  })

  it('дата задания — только у shipped/delivered, не у отменённого', () => {
    const r = orderStatusRow({ ...doc, DeletionMark: true }, '2026-10-21T00:00:00+03:00', undefined, { trip: { status: 'delivered', date: '2026-10-27' } })!
    expect(r).toMatchObject({ status: 'cancelled', shipmentDate: '2026-10-25' })
  })

  it(`закрытый документом старше ${CLOSED_SKIP_DAYS} дней — без цепочки заданий и строк`, async () => {
    expect(CLOSED_SKIP_DAYS).toBe(30)
    const lines = { Document_ЗаказКлиента_Товары: [{ Ref_Key: G(77), Отменено: true }] }
    const old = onec({ existing: [{ ...doc, Статус: 'Закрыт', Date: '2026-09-15T00:00:00' }], extra: { ...lines, ...chain({ Статус: 'Закрыто' }) } })
    const r = await readOrderStatuses(old.client, new Date('2026-10-21T09:00:00Z'))
    expect(r[0]!.row.status).toBe('shipped')
    expect(old.calls.filter(c => c.url.includes('РасходныйОрдер') || c.url.includes('_Товары'))).toHaveLength(0)
    const fresh = onec({ existing: [{ ...doc, Статус: 'Закрыт', Date: '2026-10-01T00:00:00' }], extra: { ...lines } })
    expect((await readOrderStatuses(fresh.client, new Date('2026-10-21T09:00:00Z')))[0]!.row.status).toBe('cancelled')
  })

  it('закрыт и все строки отменены — cancelled; не все или не закрыт — нет', async () => {
    const lines = (...off: boolean[]) => ({ Document_ЗаказКлиента_Товары: off.map(o => ({ Ref_Key: G(77), Отменено: o })) })
    const closed = { ...doc, Статус: 'Закрыт' }
    expect((await run(closed, lines(true, true)))[0]!.row.status).toBe('cancelled')
    expect((await run(closed, lines(true, false)))[0]!.row.status).toBe('shipped')
    expect((await run(closed, lines()))[0]!.row.status).toBe('shipped')
    expect((await run(doc, lines(true, true)))[0]!.row.status).toBe('assembled')
    // Закрыт по состоянию регистра — тоже.
    const byState = await run({ ...doc, Статус: 'КОбеспечению' }, { ...lines(true), InformationRegister_СостоянияЗаказовКлиентов: [{ Заказ: G(77), Состояние: 'Закрыт' }] })
    expect(byState[0]!.row.status).toBe('cancelled')
    // Отменённый целиком — задания не читаем.
    const t = onec({ existing: [closed], extra: { ...lines(true), ...chain({ Статус: 'Закрыто' }) } })
    await readOrderStatuses(t.client, new Date('2026-10-21T09:00:00Z'))
    expect(t.calls.filter(c => c.url.includes('РасходныйОрдер'))).toHaveLength(0)
  })

  it('приоритет: отмена строк важнее задания «Закрыто»; удаление и непроведён — важнее всего', () => {
    const d = { Ref_Key: G(77), Posted: true, Статус: 'Закрыт' }
    const trip = { status: 'delivered' as const, date: '2026-10-27' }
    expect(orderStatusOf(d, undefined, { allLinesCancelled: true, trip })).toBe('cancelled')
    expect(orderStatusOf({ ...d, Posted: false }, undefined, { allLinesCancelled: true, trip })).toBe('new')
    expect(orderStatusOf({ ...d, DeletionMark: true }, undefined, { trip })).toBe('cancelled')
    expect(orderStatusOf(d, 'ГотовКОтгрузке', { trip })).toBe('delivered')
    expect(orderStatusOf(d, 'ГотовКОтгрузке', { trip: { status: 'shipped', date: null } })).toBe('shipped')
    expect(orderStatusOf(d, 'ГотовКОтгрузке', { trip: { status: 'shipped', date: null }, allLinesCancelled: false })).toBe('shipped')
  })

  it('поля «Отменено» нет — правило пропущено, предупреждение без ПДн', async () => {
    const t = onec({ existing: [{ ...doc, Статус: 'Закрыт' }], extra: { Document_ЗаказКлиента_Товары: [{ Ref_Key: G(77), Отменено: true }] } })
    const list = t.client.list.bind(t.client)
    t.client.list = (async (set: string, q: never) => {
      if (set === 'Document_ЗаказКлиента_Товары') throw new Error('HTTP 400 Отменено ЛК-55')
      return list(set, q)
    }) as typeof t.client.list
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rows = await readOrderStatuses(t.client, new Date('2026-10-21T09:00:00Z'))
    expect(rows[0]!.row.status).toBe('shipped')
    expect(String(warn.mock.calls[0]![0])).not.toContain('ЛК-55')
    warn.mockRestore()
  })
})
