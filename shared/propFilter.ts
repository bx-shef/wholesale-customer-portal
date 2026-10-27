/**
 * Фильтры каталога по характеристикам товара (решение владельца 2026-10-27): цвет, объём, вес,
 * степень блеска и т. п. В адресе — повтор `prop=Название::Значение`; внутри одной характеристики
 * значения — «или», между характеристиками — «и».
 */
export type PropFilters = Record<string, string[]>

/** Характеристики в фильтре по умолчанию (`CATALOG_FILTER_PROPERTIES` — свой список), без учёта регистра. */
// Названия — как в «Дополнительных реквизитах» 1С заказчика (замер 2026-10-27, по числу товаров);
// фильтр показывает характеристику, только если в разделе у неё два значения и больше.
export const DEFAULT_FILTER_PROPERTIES = [
  'Цвет', 'Степень блеска', 'Объем', 'Объём', 'Вес', 'Производитель', 'Страна изготовления',
  'Материал', 'Основа материала', 'Основа', 'Назначение', 'Применение', 'Тип поверхности', 'Тип работ',
  'Способ нанесения', 'База для колеровки', 'Время высыхания', 'Класс износостойкости', 'Класс прочности',
  'Длина, мм', 'Ширина, мм', 'Высота, мм', 'Толщина, мм', 'Диаметр, мм', 'Диаметр резьбы, мм',
  'Мощность (Вт)', 'Мощность, Вт', 'Тип цоколя', 'Тип лампы', 'Цветовая температура, К', 'Степень защиты, IP',
  'Размер обуви',
]

/** Список из окружения: названия бывают с запятой («Длина, мм») — разделитель `;`, без него — запятая. */
export function parsePropertyList(raw: string): string[] {
  return raw.split(raw.includes(';') ? ';' : ',').map(s => s.trim()).filter(Boolean)
}

const SEP = '::'
export const PROP_NAMES_MAX = 10
export const PROP_VALUES_MAX = 20
const TEXT_MAX = 100

/** Из адреса: кривое отбрасывается, длина и количество ограничены. */
export function parseProps(v: unknown): PropFilters {
  const out: PropFilters = {}
  for (const raw of (Array.isArray(v) ? v : [v])) {
    if (typeof raw !== 'string') continue
    const i = raw.indexOf(SEP)
    if (i <= 0) continue
    const name = raw.slice(0, i).trim().slice(0, TEXT_MAX)
    const value = raw.slice(i + SEP.length).trim().slice(0, TEXT_MAX)
    if (!name || !value) continue
    if (!out[name] && Object.keys(out).length >= PROP_NAMES_MAX) continue
    const list = (out[name] ??= [])
    if (!list.includes(value) && list.length < PROP_VALUES_MAX) list.push(value)
  }
  return out
}

/** В адрес: имена и значения по порядку, чтобы одинаковые фильтры давали одинаковую ссылку. */
export function propsToQuery(p: PropFilters): string[] {
  return Object.keys(p).sort().flatMap(n => [...p[n]!].sort().map(v => `${n}${SEP}${v}`))
}

export const propCount = (p: PropFilters) => Object.values(p).reduce((s, l) => s + l.length, 0)

/** Значения по-человечески: «2,5 л» раньше «10 л». */
export const compareValues = (a: string, b: string) => a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' })

/** Подпись выбора в поле фильтра: «По бетону», «По бетону и ещё 3» — поле не растягивается списком (замечание владельца 2026-10-27). */
export function selectedSummary(values: readonly string[]): string {
  if (!values.length) return ''
  return values.length === 1 ? values[0]! : `${values[0]} и ещё ${values.length - 1}`
}
