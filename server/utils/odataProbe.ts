/**
 * Разведка OData 1С (docs/onec-odata.md): какие объекты нужны ЛК, опубликованы ли они и из каких
 * полей состоят. Читает только `$metadata` и по одной строке ключа каждого набора, чтобы проверить
 * права на чтение. Значений полей в отчёт не кладём: в публикации лежат и персональные данные.
 *
 * Чистое ядро: `fetch` внедряется, тесты гоняют его на фикстуре.
 */
import { onecAuthHeader, type OnecAuth } from '../services/onec'

/** Объекты 1С, из которых ЛК собирает свой контракт, и зачем каждый нужен. */
export const ODATA_SETS: ReadonlyArray<{ name: string, why: string }> = [
  { name: 'Catalog_Номенклатура', why: 'каталог' },
  { name: 'Catalog_ВидыНоменклатуры', why: 'группы каталога' },
  { name: 'Catalog_НоменклатураПрисоединенныеФайлы', why: 'картинки товаров' },
  { name: 'InformationRegister_ЦеныНоменклатуры25', why: 'цены' },
  { name: 'Catalog_ВидыЦен', why: 'виды цен' },
  { name: 'AccumulationRegister_ТоварыНаСкладах', why: 'остатки' },
  { name: 'Catalog_Склады', why: 'склады' },
  { name: 'Catalog_Партнеры', why: 'клиенты' },
  { name: 'Catalog_Контрагенты', why: 'юрлица клиентов' },
  { name: 'Catalog_СоглашенияСКлиентами', why: 'соглашения: вид цен и оплата (#46)' },
  { name: 'Catalog_ДоговорыКонтрагентов', why: 'договоры' },
  { name: 'Catalog_СегментыПартнеров', why: 'сегмент запрета отгрузки' },
  { name: 'Catalog_ЗоныДоставки', why: 'зона доставки клиента (#46)' },
  { name: 'Catalog_БизнесРегионы', why: 'бизнес-регионы' },
  { name: 'Document_ЗаказКлиента', why: 'заказы: запись и статусы' },
  { name: 'Document_ЗаданиеНаПеревозку', why: 'рейсы' },
  // Второй круг (разведка 2026-10-20): на них ссылаются поля первых шестнадцати.
  { name: 'Catalog_УпаковкиЕдиницыИзмерения', why: 'единица и кратность товара' },
  { name: 'Catalog_Марки', why: 'бренд товара' },
  { name: 'Catalog_Валюты', why: 'код валюты цены и соглашения' },
  { name: 'Catalog_СтавкиНДС', why: 'ставка НДС товара' },
  { name: 'Catalog_Организации', why: 'организация в заказе' },
  { name: 'Catalog_Пользователи', why: 'менеджер клиента' },
  { name: 'ChartOfCharacteristicTypes_ДополнительныеРеквизитыИСведения', why: 'имена свойств товара' },
  { name: 'AccumulationRegister_РасчетыСКлиентами', why: 'долг клиента' },
  { name: 'Document_РеализацияТоваровУслуг', why: 'отгрузка заказа (статус «отгружен»)' },
]

export interface ODataType {
  name: string
  properties: Array<{ name: string, type: string }>
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? ''

/** Типы из `$metadata`: EntityType и ComplexType (табличные части 1С описаны как ComplexType). */
export function parseMetadata(xml: string): Map<string, ODataType> {
  const types = new Map<string, ODataType>()
  const re = /<(EntityType|ComplexType)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g
  for (const m of xml.matchAll(re)) {
    const name = attr(m[2]!, 'Name')
    if (!name) continue
    const properties = [...(m[4] ?? '').matchAll(/<(?:Property|NavigationProperty)\b([^>]*)>/g)]
      .map(p => ({ name: attr(p[1]!, 'Name'), type: attr(p[1]!, 'Type') }))
      .filter(p => p.name)
    types.set(name, { name, properties })
  }
  return types
}

/** Набор и его табличные части: `Document_ЗаказКлиента` и `Document_ЗаказКлиента_Товары…`. */
export function typesOf(set: string, types: Map<string, ODataType>): ODataType[] {
  return [...types.values()]
    .filter(t => t.name === set || t.name.startsWith(`${set}_`))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface ODataCheck {
  id: string
  title: string
  status: 'ok' | 'fail' | 'skip'
  detail: string
  /** Поля типа и его табличных частей — только имена и типы. */
  fields?: ODataType[]
  ms: number
}

export interface ODataProbeInput {
  /** Адрес публикации OData: `https://…/<база>/odata/standard.odata`. */
  baseUrl: string
  auth: OnecAuth
  fetch: typeof fetch
  timeoutMs?: number
}

export async function runODataProbe(input: ODataProbeInput, now: () => number = Date.now): Promise<ODataCheck[]> {
  const base = input.baseUrl.replace(/\/+$/, '')
  const headers = { authorization: onecAuthHeader(input.auth) }
  const get = (path: string, accept: string) =>
    input.fetch(base + path, { headers: { ...headers, accept }, signal: AbortSignal.timeout(input.timeoutMs ?? 60_000) })
  const checks: ODataCheck[] = []

  let started = now()
  let types: Map<string, ODataType>
  try {
    const res = await get('/$metadata', 'application/xml')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    types = parseMetadata(await res.text())
    checks.push({ id: 'metadata', title: 'Описание публикации ($metadata)', status: 'ok', detail: `типов: ${types.size}`, ms: now() - started })
  }
  catch (e) {
    checks.push({ id: 'metadata', title: 'Описание публикации ($metadata)', status: 'fail', detail: reason(e), ms: now() - started })
    return checks
  }

  for (const set of ODATA_SETS) {
    const title = `${set.name} — ${set.why}`
    const fields = typesOf(set.name, types)
    if (!fields.length) {
      checks.push({ id: set.name, title, status: 'fail', detail: 'не опубликован', ms: 0 })
      continue
    }
    started = now()
    try {
      // Права на чтение: одна строка, без полей — значения в отчёт не попадают.
      const res = await get(`/${encodeURIComponent(set.name)}?$top=1&$select=${keyOf(fields[0]!)}&$format=json`, 'application/json')
      checks.push(res.ok
        ? { id: set.name, title, status: 'ok', detail: 'читается', fields, ms: now() - started }
        : { id: set.name, title, status: 'fail', detail: `опубликован, чтение — HTTP ${res.status}`, fields, ms: now() - started })
    }
    catch (e) {
      checks.push({ id: set.name, title, status: 'fail', detail: reason(e), fields, ms: now() - started })
    }
  }
  return checks
}

/** Ключ набора: у справочников и документов `Ref_Key`, у регистров — первое поле. */
function keyOf(t: ODataType): string {
  return t.properties.some(p => p.name === 'Ref_Key') ? 'Ref_Key' : (t.properties[0]?.name ?? 'Ref_Key')
}

function reason(e: unknown): string {
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'нет ответа за 60 с'
  return e instanceof Error ? e.message : String(e)
}

/** Плоский текст полей для пересылки разработчику: имена и типы, без значений. */
export function fieldsText(checks: ODataCheck[]): string {
  return checks
    .flatMap(c => [`# ${c.title}: ${c.detail}`, ...(c.fields ?? []).flatMap(t => [`## ${t.name}`, ...t.properties.map(p => `${p.name}: ${p.type}`)])])
    .join('\n')
}
