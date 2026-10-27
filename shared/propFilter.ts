/**
 * Фильтры каталога по характеристикам товара (решение владельца 2026-10-27): цвет, объём, вес,
 * степень блеска и т. п. В адресе — повтор `prop=Название::Значение`; внутри одной характеристики
 * значения — «или», между характеристиками — «и».
 */
export type PropFilters = Record<string, string[]>

/** Характеристики в фильтре по умолчанию (`CATALOG_FILTER_PROPERTIES` — свой список), без учёта регистра. */
export const DEFAULT_FILTER_PROPERTIES = [
  'Цвет', 'Оттенок', 'Объем', 'Объём', 'Вес', 'Масса', 'Вес нетто', 'Степень блеска', 'Блеск',
  'Производитель', 'Страна', 'Страна происхождения', 'Материал', 'Основа', 'Назначение',
  'Фасовка', 'Размер', 'Толщина', 'Длина', 'Ширина', 'Диаметр', 'Морозостойкость',
]

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
