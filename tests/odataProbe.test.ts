import { describe, expect, it } from 'vitest'
import { fieldsText, ODATA_SETS, parseMetadata, runODataProbe, typesOf } from '../server/utils/odataProbe'

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
