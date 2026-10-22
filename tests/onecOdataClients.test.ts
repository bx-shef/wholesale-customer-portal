import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from '../server/db/sqlite'
import { ODataClient } from '../server/services/onecOdata'
import { addressGuid, agreementActive, emptyClientStats, mapClients, readClientSources, type ClientSources } from '../server/services/onecOdataClients'
import { minskDay, OdataOnec } from '../server/services/onecOdataSource'
import { sqliteVersionStore } from '../server/utils/odataVersions'
import { Client } from '../shared/onec/schemas'

const G = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const TODAY = '2026-10-21'
const base = (over: Partial<ClientSources> = {}): ClientSources => ({
  partners: [{ Ref_Key: G(1).toUpperCase(), Description: ' ООО Ромашка ', Клиент: true, ЗонаДоставки_Key: G(50) }],
  counterparties: [{ Ref_Key: G(2), Партнер_Key: G(1), ИНН: ' 190000001 ' }],
  agreements: [{ Ref_Key: G(3), Партнер_Key: G(1), Статус: 'Действует', Номер: 'С-1', Дата: '2026-01-10T00:00:00', ВидЦен_Key: G(30), Валюта_Key: G(40), Договор_Key: G(4) }],
  contracts: [{ Ref_Key: G(4), Номер: 'Д-1', ДопустимаяСуммаЗадолженности: 1000.555 }],
  contacts: [{ Ref_Key: G(1), LineNumber: '1', Тип: 'Адрес', Вид_Key: G(60), Представление: 'Минск, ул. Ленина, 1', Город: 'Минск' }],
  zones: new Map([[G(50), 'Минск-Север']]),
  currencies: new Map([[G(40), 'BYN']]),
  blocked: new Set(),
  ...over,
})

describe('agreementActive', () => {
  const a = { Ref_Key: G(3), Статус: 'Действует' }
  it('статус, пометка удаления и даты действия', () => {
    expect(agreementActive(a, TODAY)).toBe(true)
    expect(agreementActive({ ...a, Статус: 'Закрыто' }, TODAY)).toBe(false)
    expect(agreementActive({ ...a, DeletionMark: true }, TODAY)).toBe(false)
    expect(agreementActive({ ...a, ДатаОкончанияДействия: '2026-10-20T00:00:00' }, TODAY)).toBe(false)
    expect(agreementActive({ ...a, ДатаОкончанияДействия: '2026-10-21T00:00:00' }, TODAY)).toBe(true)
    expect(agreementActive({ ...a, ДатаОкончанияДействия: '0001-01-01T00:00:00' }, TODAY)).toBe(true)
    expect(agreementActive({ ...a, ДатаНачалаДействия: '2026-10-22T00:00:00' }, TODAY)).toBe(false)
  })
})

describe('mapClients', () => {
  it('переносит партнёра, УНП, зону, адрес и соглашение в форму контракта', () => {
    const [r] = mapClients(base(), TODAY)
    expect(r!.client).toMatchObject({
      guid: G(1), name: 'ООО Ромашка', unp: '190000001', city: 'Минск', address: 'Минск, ул. Ленина, 1',
      region: { guid: G(50), name: 'Минск-Север' }, shipmentBlocked: false, deleted: false,
      contract: { guid: G(3), number: 'С-1', date: '2026-01-10', priceTypeGuid: G(30), currency: 'BYN', creditLimit: 1000.56, debt: 0 },
    })
    expect(r!.client.deliveryAddresses).toHaveLength(1)
    expect(Client.safeParse({ ...r!.client, changedAt: '2026-10-21T00:00:00+03:00' }).success).toBe(true)
  })

  it('несколько действующих соглашений — самое позднее; без соглашения — договора нет', () => {
    const stats = emptyClientStats()
    const two = base({ agreements: [...base().agreements, { ...base().agreements[0]!, Ref_Key: G(5), Дата: '2026-05-01T00:00:00' }] })
    expect(mapClients(two, TODAY, stats)[0]!.client.contract?.guid).toBe(G(5))
    expect(stats.manyAgreements).toBe(1)
    const none = mapClients(base({ agreements: [] }), TODAY, stats)
    expect(none[0]!.client.contract).toBeNull()
    expect(none[0]!.client.deleted).toBe(true)
    expect(stats.noAgreement).toBe(1)
  })

  it('без вида цен или валюты — договора нет; соглашение с видом цен выигрывает у более позднего без него', () => {
    const s = emptyClientStats()
    const a0 = base().agreements[0]!
    expect(mapClients(base({ agreements: [{ ...a0, ВидЦен_Key: undefined }] }), TODAY, s)[0]!.client.contract).toBeNull()
    expect(s.noPriceType).toBe(1)
    expect(mapClients(base({ currencies: new Map([[G(40), 'USD']]) }), TODAY, s)[0]!.client.contract?.currency).toBe('USD')
    expect(mapClients(base({ currencies: new Map() }), TODAY, s)[0]!.client.contract).toBeNull()
    expect(s.noCurrency).toBe(1)
    const late = { ...a0, Ref_Key: G(7), Дата: '2026-09-01T00:00:00', ВидЦен_Key: undefined }
    expect(mapClients(base({ agreements: [a0, late] }), TODAY)[0]!.client.contract?.guid).toBe(G(3))
  })

  it('равные даты — по ссылке, не по порядку; начало действия важнее даты', () => {
    const a0 = base().agreements[0]!
    const b = { ...a0, Ref_Key: G(2) }
    expect(mapClients(base({ agreements: [a0, b] }), TODAY)[0]!.client.contract?.guid).toBe(G(2))
    expect(mapClients(base({ agreements: [b, a0] }), TODAY)[0]!.client.contract?.guid).toBe(G(2))
    const started = { ...a0, Ref_Key: G(9), Дата: '2025-01-01T00:00:00', ДатаНачалаДействия: '2026-06-01T00:00:00' }
    expect(mapClients(base({ agreements: [a0, started] }), TODAY)[0]!.client.contract?.guid).toBe(G(9))
  })

  it('номер и дата — из договора, если у соглашения пусто; без обеих дат — 2000-01-01', () => {
    const a0 = { ...base().agreements[0]!, Номер: '', Дата: '0001-01-01T00:00:00' }
    const c = mapClients(base({ agreements: [a0], contracts: [{ Ref_Key: G(4), Номер: 'Д-1', Дата: '2025-03-04T00:00:00' }] }), TODAY)[0]!.client.contract!
    expect(c).toMatchObject({ number: 'Д-1', date: '2025-03-04' })
    expect(mapClients(base({ agreements: [a0], contracts: [] }), TODAY)[0]!.client.contract!.date).toBe('2000-01-01')
  })

  it('ссылки в верхнем регистре сопоставляются; удалённый контрагент и не-адрес не берутся; адреса без дублей', () => {
    const s = emptyClientStats()
    const H = 'abcdef00-0000-0000-0000-00000000000a'
    const up = mapClients(base({ partners: [{ Ref_Key: H, Клиент: true }], counterparties: [{ Ref_Key: G(2), Партнер_Key: H.toUpperCase(), ИНН: '7' }], agreements: [{ ...base().agreements[0]!, Партнер_Key: H.toUpperCase() }] }), TODAY)[0]!.client
    expect(up).toMatchObject({ unp: '7', contract: { guid: G(3) } })
    const r = mapClients(base({
      counterparties: [{ Ref_Key: G(2), Партнер_Key: G(1).toUpperCase(), ИНН: '1', DeletionMark: true }, { Ref_Key: G(3), Партнер_Key: G(1).toUpperCase(), ИНН: '2' }],
      agreements: [{ ...base().agreements[0]!, Партнер_Key: G(1).toUpperCase() }],
      contacts: [
        ...base().contacts, ...base().contacts,
        { Ref_Key: G(1), Тип: 'Телефон', Представление: '+375 29 000' },
      ],
    }), TODAY, s)[0]!.client
    expect(r.unp).toBe('2')
    expect(r.contract).not.toBeNull()
    expect(r.deliveryAddresses).toHaveLength(1)
    const none = mapClients(base({ counterparties: [{ Ref_Key: G(2), Партнер_Key: G(1), ИНН: '1', DeletionMark: true }] }), TODAY, s)[0]!.client
    expect(none.unp).toBe('')
  })

  it('checkedClients: строка, ломающая контракт, — ошибка contract', async () => {
    const { checkedClients } = await import('../server/services/onecOdataClients')
    const [ok] = mapClients(base(), TODAY)
    expect(checkedClients([ok!])).toHaveLength(1)
    expect(() => checkedClients([{ ...ok!, client: { ...ok!.client, region: { guid: 'x', name: 'z' } } }])).toThrow(expect.objectContaining({ kind: 'contract' }))
  })

  it('unsupportedFlowsFor: клиенты по OData — только с ONEC_ODATA_CLIENTS', async () => {
    const { unsupportedFlowsFor } = await import('../server/services/onecOdataSource')
    expect(unsupportedFlowsFor({ onecMock: false, onecMode: 'odata', onecOdataClients: false, onecOdataOrders: false, onecOdataTrips: false })).toContain('clients')
    expect(unsupportedFlowsFor({ onecMock: false, onecMode: 'odata', onecOdataClients: true, onecOdataOrders: false, onecOdataTrips: false })).not.toContain('clients')
    expect(unsupportedFlowsFor({ onecMock: false, onecMode: 'odata', onecOdataClients: true, onecOdataOrders: false, onecOdataTrips: false })).toContain('orders')
    expect(unsupportedFlowsFor({ onecMock: false, onecMode: 'odata', onecOdataClients: false, onecOdataOrders: true, onecOdataTrips: false })).toEqual(['clients', 'trips', 'schedule'])
    expect(unsupportedFlowsFor({ onecMock: false, onecMode: 'odata', onecOdataClients: true, onecOdataOrders: true, onecOdataTrips: true })).toEqual(['schedule'])
    expect(unsupportedFlowsFor({ onecMock: true, onecMode: 'odata', onecOdataClients: false, onecOdataOrders: false, onecOdataTrips: false })).toEqual([])
    expect(unsupportedFlowsFor({ onecMock: false, onecMode: 'http', onecOdataClients: false, onecOdataOrders: false, onecOdataTrips: false })).toEqual([])
  })

  it('sampleName: организации — как есть, прочее (ИП — ФИО) — скрыто', async () => {
    const { sampleName } = await import('../server/utils/odataProbe')
    expect(sampleName('ООО «Ромашка»')).toBe('ООО «Ромашка»')
    expect(sampleName('Частное унитарное предприятие «Бета»')).toBe('Частное унитарное предприятие «Бета»')
    expect(sampleName('Частное лицо Иванов И.И.')).toBe('Ча… (24 симв.)')
    expect(sampleName('Уп Иванов')).toBe('Уп… (9 симв.)')
    expect(sampleName('Иванов Иван Иванович')).toBe('Ив… (20 симв.)')
    expect(sampleName('ИП Иванов')).toBe('ИП… (9 симв.)')
  })

  it('запрет отгрузки, без зоны, не клиент, помечен на удаление', () => {
    const s = emptyClientStats()
    const rows = mapClients(base({
      partners: [...base().partners, { Ref_Key: G(9), Клиент: false }, { Ref_Key: G(8), DeletionMark: true, Клиент: true }],
      blocked: new Set([G(1)]),
      zones: new Map(),
    }), TODAY, s)
    expect(rows.map(r => r.client.guid)).toEqual([G(1), G(8)])
    expect(rows[0]!.client).toMatchObject({ shipmentBlocked: true, region: null })
    expect(rows[1]!.client).toMatchObject({ deleted: true, unp: '', contract: null, deliveryAddresses: [] })
    expect(s).toMatchObject({ clients: 2, blocked: 1, noZone: 2, noUnp: 1, noAddress: 1 })
  })

  it('версия меняется, когда меняется видимое клиенту; адрес — устойчивый GUID', async () => {
    const v1 = mapClients(base(), TODAY)[0]!.version
    expect(mapClients(base(), TODAY)[0]!.version).toBe(v1)
    expect(mapClients(base({ zones: new Map([[G(50), 'Минск-Юг']]) }), TODAY)[0]!.version).not.toBe(v1)
    const { clientVersion } = await import('../server/services/onecOdataClients')
    const c = mapClients(base(), TODAY)[0]!.client
    expect(clientVersion({ ...c, changedAt: '2026-01-01T00:00:00+03:00' })).toBe(clientVersion(c))
    expect(addressGuid(G(1), G(60), 'А')).toBe(addressGuid(G(1), G(60), 'А'))
    expect(addressGuid(G(1), G(60), 'А')).not.toBe(addressGuid(G(1), G(60), 'Б'))
    expect(addressGuid(G(1), G(60), 'А')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('readClientSources и OdataOnec.clients', () => {
  const fake = (fail: string[] = []): typeof fetch => async (u) => {
    const url = decodeURIComponent(String(u))
    const set = /standard\.odata\/([^?]+)\?/.exec(url)![1]!
    if (fail.includes(set)) return new Response('', { status: 404 })
    const data: Record<string, unknown[]> = {
      Catalog_Партнеры: base().partners,
      Catalog_Контрагенты: base().counterparties,
      Catalog_СоглашенияСКлиентами: base().agreements,
      Catalog_ДоговорыКонтрагентов: base().contracts,
      Catalog_Партнеры_КонтактнаяИнформация: base().contacts,
      Catalog_ЗоныДоставки: [{ Ref_Key: G(50), Description: 'Минск-Север' }],
      Catalog_Валюты: [{ Ref_Key: G(40), Code: '933', Description: 'BYN' }],
      Catalog_СегментыПартнеров: [{ Ref_Key: G(70), ЗапретОтгрузки: true }, { Ref_Key: G(71), ЗапретОтгрузки: false }],
      Catalog_СегментыПартнеров_ПартнерыПоСегменту: [{ Ref_Key: G(70), Партнер_Key: G(1) }, { Ref_Key: G(71), Партнер_Key: G(2) }],
    }
    if (set === 'Catalog_Партнеры') expect(url).toContain('$filter=Клиент eq true')
    return Response.json({ value: data[set] ?? [] })
  }
  const client = (f: typeof fetch) => new ODataClient({ baseUrl: 'https://x/b/odata/standard.odata', auth: { kind: 'bearer', token: 't' }, fetch: f })

  it('читает всё, запрет отгрузки — по сегменту с запретом', async () => {
    const src = await readClientSources(client(fake()))
    expect([...src.blocked]).toEqual([G(1)])
  })

  it('всё обязательно: не прочиталось — прогон падает, запрет отгрузки молча не снимается', async () => {
    for (const set of ['Catalog_СегментыПартнеров', 'Catalog_СегментыПартнеров_ПартнерыПоСегменту', 'Catalog_Партнеры', 'Catalog_Контрагенты', 'Catalog_СоглашенияСКлиентами', 'Catalog_ДоговорыКонтрагентов', 'Catalog_Партнеры_КонтактнаяИнформация', 'Catalog_ЗоныДоставки', 'Catalog_Валюты'])
      await expect(readClientSources(client(fake([set]))), set).rejects.toBeInstanceOf(Error)
  })

  it('без сегментов с запретом участников не спрашиваем; удалённый сегмент не блокирует', async () => {
    const urls: string[] = []
    const f = fake()
    const spy: typeof fetch = async (u, i) => {
      const url = decodeURIComponent(String(u))
      urls.push(url)
      if (url.includes('Catalog_СегментыПартнеров?')) return Response.json({ value: [{ Ref_Key: G(70), ЗапретОтгрузки: true, DeletionMark: true }] })
      return f(u, i)
    }
    const src = await readClientSources(client(spy))
    expect(src.blocked.size).toBe(0)
    expect(urls.some(u => u.includes('ПартнерыПоСегменту'))).toBe(false)
  })

  it('OdataOnec.clients: страница контракта, момент держится, пока клиент не изменился', async () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    let clock = new Date('2026-10-21T10:00:00Z')
    const api = new OdataOnec(client(fake()), sqliteVersionStore(db), { now: () => clock, ttlMs: 0 })
    const p1 = await api.clients({})
    expect(p1.items.map(c => c.guid)).toEqual([G(1)])
    expect(p1.items[0]!.shipmentBlocked).toBe(true)
    clock = new Date('2026-10-21T11:00:00Z')
    expect((await api.clients({})).items[0]!.changedAt).toBe(p1.items[0]!.changedAt)
  })

  it('minskDay — дата по Минску', () => {
    expect(minskDay(new Date('2026-10-20T21:30:00Z'))).toBe('2026-10-21')
    expect(minskDay(new Date('2026-10-20T20:59:00Z'))).toBe('2026-10-20')
  })
})

describe('стенд: runODataClientsProbe', async () => {
  const { runODataClientsProbe } = await import('../server/utils/odataProbe')
  it('счётчики, распределения и образец; партнёры не читаются — fail с причиной', async () => {
    const data: Record<string, unknown[]> = {
      Catalog_Партнеры: base().partners,
      Catalog_СоглашенияСКлиентами: [...base().agreements, { Ref_Key: G(6), Партнер_Key: G(1), Статус: 'Закрыто' }],
      Catalog_ЗоныДоставки: [{ Ref_Key: G(50), Description: 'Минск-Север' }],
      Catalog_ВидыЦен: [{ Ref_Key: G(30), Description: 'Опт' }],
      Catalog_Валюты: [{ Ref_Key: G(40), Code: '933', Description: 'BYN' }],
    }
    const fake: typeof fetch = async (u) => {
      const set = /standard\.odata\/([^?]+)\?/.exec(decodeURIComponent(String(u)))![1]!
      return Response.json({ value: data[set] ?? [] })
    }
    const [c, order] = await runODataClientsProbe({ baseUrl: 'https://x/b/odata/standard.odata', auth: { kind: 'bearer', token: 't' }, fetch: fake })
    // Адресов в данных нет — тестовый заказ пропущен, а не упал.
    expect(order).toMatchObject({ id: 'order', status: 'skip' })
    expect(c).toMatchObject({ status: 'ok' })
    expect(c!.detail).toContain('клиентов: 1, с соглашением: 1')
    const fields = Object.fromEntries(c!.fields!.map(f => [f.name, f.properties.map(p => p.name)]))
    expect(fields['Статусы соглашений']).toEqual(['Действует: 1', 'Закрыто: 1'])
    expect(fields['Виды цен в соглашениях']).toEqual(['Опт: 1'])
    expect(fields['Образец']![0]).toContain('ОО… (11 симв.) · УНП нет · Минск-Север · соглашение С-1 · Опт · BYN')
    const bad = await runODataClientsProbe({ baseUrl: 'https://x/b/odata/standard.odata', auth: { kind: 'bearer', token: 't' }, fetch: async () => new Response('', { status: 403 }) })
    expect(bad[0]).toMatchObject({ status: 'fail' })
    expect(bad[0]!.detail).toContain('403')
  })
})
