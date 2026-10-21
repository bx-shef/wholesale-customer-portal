import { describe, expect, it } from 'vitest'
import { fieldsText, ODATA_SETS, parseMetadata, runODataCatalogProbe, runODataPricesProbe, runODataProbe, typesOf } from '../server/utils/odataProbe'

const META = `<?xml version="1.0"?><edmx:Edmx><edmx:DataServices><Schema>
<EntityType Name="Catalog_ЗоныДоставки"><Key><PropertyRef Name="Ref_Key"/></Key>
<Property Name="Ref_Key" Type="Edm.Guid" Nullable="false"/><Property Name="Description" Type="Edm.String"/></EntityType>
<EntityType Name="Document_ЗаказКлиента"><Property Name="Ref_Key" Type="Edm.Guid"/><Property Name="Товары" Type="Collection(StandardODATA.Document_ЗаказКлиента_Товары_RowType)"/>
<NavigationProperty Name="Партнер" Relationship="x"/></EntityType>
<ComplexType Name="Document_ЗаказКлиента_Товары_RowType"><Property Name="Номенклатура_Key" Type="Edm.Guid"/></ComplexType>
<EntityType Name="Catalog_ЗоныДоставкиЧужие"><Property Name="Ref_Key" Type="Edm.Guid"/></EntityType>
<EntityType Name="Пустой"/>
</Schema></edmx:DataServices></edmx:Edmx>`

describe('parseMetadata', () => {
  it('читает поля, навигацию и табличные части', () => {
    const t = parseMetadata(META)
    expect(t.get('Catalog_ЗоныДоставки')!.properties).toEqual([{ name: 'Ref_Key', type: 'Edm.Guid' }, { name: 'Description', type: 'Edm.String' }])
    expect(t.get('Document_ЗаказКлиента')!.properties.map(p => p.name)).toEqual(['Ref_Key', 'Товары', 'Партнер'])
    expect(t.get('Пустой')!.properties).toEqual([])
    expect(typesOf('Document_ЗаказКлиента', t).map(x => x.name)).toEqual(['Document_ЗаказКлиента', 'Document_ЗаказКлиента_Товары_RowType'])
    // Похожее имя без разделителя — чужой объект.
    expect(typesOf('Catalog_ЗоныДоставки', t).map(x => x.name)).toEqual(['Catalog_ЗоныДоставки'])
  })
})

describe('runODataProbe', () => {
  const urls: string[] = []
  const fake: typeof fetch = async (u, init) => {
    urls.push(String(u))
    expect(new Headers(init?.headers).get('authorization')).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`)
    if (String(u).endsWith('/$metadata')) return new Response(META)
    if (decodeURIComponent(String(u)).includes('ЗаказКлиента')) return new Response('', { status: 403 })
    return new Response('{"value":[{"Ref_Key":"secret-guid"}]}')
  }

  it('отмечает опубликованное, права и не отдаёт значений', async () => {
    const checks = await runODataProbe({ baseUrl: 'https://1c.example/b/odata/standard.odata/', auth: { kind: 'basic', login: 'u', password: 'p' }, fetch: fake })
    expect(checks).toHaveLength(ODATA_SETS.length + 1)
    const by = (id: string) => checks.find(c => c.id === id)!
    expect(by('Catalog_ЗоныДоставки')).toMatchObject({ status: 'ok', detail: 'читается' })
    expect(by('Document_ЗаказКлиента')).toMatchObject({ status: 'fail', detail: 'опубликован, чтение — HTTP 403' })
    expect(by('Catalog_Номенклатура')).toMatchObject({ status: 'fail', detail: 'не опубликован' })
    expect(urls).toContain(`https://1c.example/b/odata/standard.odata/${encodeURIComponent('Catalog_ЗоныДоставки')}?$top=1&$select=Ref_Key&$format=json`)
    expect(JSON.stringify(checks) + fieldsText(checks)).not.toContain('secret-guid')
    expect(fieldsText(checks)).toContain('## Document_ЗаказКлиента_Товары_RowType\nНоменклатура_Key: Edm.Guid')
  })

  it('без $metadata дальше не идёт', async () => {
    const checks = await runODataProbe({ baseUrl: 'https://x', auth: { kind: 'bearer', token: 't' }, fetch: async () => new Response('', { status: 401 }) })
    expect(checks).toEqual([expect.objectContaining({ id: 'metadata', status: 'fail', detail: 'HTTP 401' })])
  })
})

describe('runODataCatalogProbe', () => {
  it('без справочников — пропуск, каталог проходит схему', async () => {
    const fake: typeof fetch = async (u) => {
      const url = decodeURIComponent(String(u))
      if (url.includes('Марки') || url.includes('Упаковки')) return new Response('', { status: 404 })
      if (url.includes('IsFolder eq true')) return Response.json({ value: [] })
      return Response.json({ value: [{ Ref_Key: '00000000-0000-0000-0000-000000000009', Description: 'Клей', Артикул: 'K1' }] })
    }
    const checks = await runODataCatalogProbe({ baseUrl: 'https://x', auth: { kind: 'bearer', token: 't' }, fetch: fake })
    expect(checks.map(c => c.status)).toEqual(['skip', 'ok'])
    expect(checks[1]!.fields![0]!.properties[0]!.name).toBe('K1 · Клей · шт')
  })
})

describe('runODataPricesProbe', () => {
  it('прайс и остатки с образцами по названиям', async () => {
    const G = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
    const fake: typeof fetch = async (u) => {
      const url = decodeURIComponent(String(u))
      if (url.includes('SliceLast')) return Response.json({ value: [{ Period: '2026-01-01T00:00:00', Номенклатура_Key: G(1), ВидЦены_Key: G(2), Цена: 3.5, Валюта_Key: G(3) }] })
      if (url.includes('Catalog_Валюты')) return Response.json({ value: [{ Ref_Key: G(3), Code: '933', Description: 'BYN' }] })
      if (url.includes('Catalog_ВидыЦен')) return Response.json({ value: [{ Ref_Key: G(2), Description: 'Опт' }] })
      if (url.includes('Catalog_СтавкиНДС')) return Response.json({ value: [] })
      if (url.includes('Catalog_Номенклатура')) return Response.json({ value: [{ Ref_Key: G(1), Description: 'Клей' }] })
      if (url.includes('/Balance(')) return Response.json({ value: [{ Номенклатура_Key: G(1), Склад_Key: G(4), ВНаличииBalance: 5 }] })
      if (url.includes('Catalog_Склады')) return Response.json({ value: [{ Ref_Key: G(4), Description: 'Минск' }] })
      return new Response('', { status: 404 })
    }
    const checks = await runODataPricesProbe({ baseUrl: 'https://x', auth: { kind: 'bearer', token: 't' }, fetch: fake })
    expect(checks.map(c => c.status)).toEqual(['ok', 'ok'])
    expect(checks[0]!.detail).toContain('чтение: ЦеныНоменклатуры25, срез последних')
    expect(checks[0]!.fields![1]!.properties[0]!.name).toBe('Клей · Опт · 3.5 BYN · НДС 0%')
    expect(checks[1]!.fields![1]!.properties[0]!.name).toBe('Клей · Минск · 5')
  })
})
