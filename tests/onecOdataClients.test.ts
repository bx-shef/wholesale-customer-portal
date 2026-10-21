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
  missing: [],
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
    expect(stats.noAgreement).toBe(1)
  })

  it('без вида цен — договора нет; без валюты — BYN и счётчик', () => {
    const s = emptyClientStats()
    expect(mapClients(base({ agreements: [{ ...base().agreements[0]!, ВидЦен_Key: undefined }] }), TODAY, s)[0]!.client.contract).toBeNull()
    expect(s.noPriceType).toBe(1)
    expect(mapClients(base({ currencies: new Map([[G(40), 'USD']]) }), TODAY, s)[0]!.client.contract?.currency).toBe('USD')
    expect(mapClients(base({ currencies: new Map() }), TODAY, s)[0]!.client.contract?.currency).toBe('BYN')
    expect(s.noCurrency).toBe(1)
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

  it('версия меняется, когда меняется видимое клиенту; адрес — устойчивый GUID', () => {
    const v1 = mapClients(base(), TODAY)[0]!.version
    expect(mapClients(base(), TODAY)[0]!.version).toBe(v1)
    expect(mapClients(base({ zones: new Map([[G(50), 'Минск-Юг']]) }), TODAY)[0]!.version).not.toBe(v1)
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
    expect(src.missing).toEqual([])
    expect([...src.blocked]).toEqual([G(1)])
  })

  it('необязательное не читается — пусто и в missing; партнёры обязательны', async () => {
    const src = await readClientSources(client(fake(['Catalog_СегментыПартнеров', 'Catalog_Контрагенты'])))
    expect(src.missing).toEqual(['Catalog_Контрагенты', 'Catalog_СегментыПартнеров'])
    expect(src.blocked.size).toBe(0)
    await expect(readClientSources(client(fake(['Catalog_Партнеры'])))).rejects.toMatchObject({ status: 404 })
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
    const [c] = await runODataClientsProbe({ baseUrl: 'https://x/b/odata/standard.odata', auth: { kind: 'bearer', token: 't' }, fetch: fake })
    expect(c).toMatchObject({ status: 'ok' })
    expect(c!.detail).toContain('клиентов: 1, с соглашением: 1')
    const fields = Object.fromEntries(c!.fields!.map(f => [f.name, f.properties.map(p => p.name)]))
    expect(fields['Статусы соглашений']).toEqual(['Действует: 1', 'Закрыто: 1'])
    expect(fields['Виды цен в соглашениях']).toEqual(['Опт: 1'])
    expect(fields['Образец']![0]).toContain('ООО Ромашка · УНП — · Минск-Север · соглашение С-1 · Опт · BYN')
    const bad = await runODataClientsProbe({ baseUrl: 'https://x/b/odata/standard.odata', auth: { kind: 'bearer', token: 't' }, fetch: async () => new Response('', { status: 403 }) })
    expect(bad[0]).toMatchObject({ status: 'fail' })
    expect(bad[0]!.detail).toContain('403')
  })
})
