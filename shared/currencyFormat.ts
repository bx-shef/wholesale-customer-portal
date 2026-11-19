// Сумма в том виде, в каком валюту показывает САМ портал (перенесено из client-bank-alfa-by
// app/utils/currencyFormat.ts, 2026-11-19; здесь запасной вид BYN — «руб.», а не код).
//
// ЗАЧЕМ. Сперва здесь стоял штатный `Intl` со `style:'currency'`, и на живом портале он выдал
// «1 840,50 BYN» рядом с «29,00 ₽» — то есть основная валюта белорусского клиента выглядела
// неотформатированной ровно там, где рублёвая выглядела нормально. Причина в том, что `Intl` знает
// СВОЙ справочник CLDR, а Bitrix24 держит свой, и у BYN там подпись «руб.», которой в CLDR нет.
//
// ЗАМЕРЕНО на живом портале 2026-09-16 (`crm.currency.list`):
//   BYN → `# руб.`   RUB → `# &#8381;`   USD → `$#`   EUR → `# &euro;`
// Отсюда три вывода, каждый из которых ломает наивную реализацию:
//   1) подпись бывает СЛЕВА (`$#`) — «число, пробел, символ» верно не всегда;
//   2) в строке живут HTML-сущности (`&#8381;`, `&euro;`), их надо раскрывать;
//   3) сущность СОДЕРЖИТ решётку, то есть плейсхолдер `#` нельзя заменять простым `replace`.
//
// ⚠ ГРУППИРОВКУ ЧИСЛА БЕРЁМ СВОЮ, А НЕ ПОРТАЛЬНУЮ, и это осознанное расхождение. Портал отдаёт
// `THOUSANDS_SEP: null` и `DEC_POINT: "."`, то есть по его же настройкам вышло бы «1840.50 руб.» —
// без разделения разрядов, ровно то «нет форматирования», с которого всё началось. Берём ru-RU
// (неразрывный пробел + запятая) и подставляем в ПОРТАЛЬНЫЙ шаблон: подпись и её место — от
// портала, читаемость числа — наша.
//
// ⚠ ПОРТАЛ МОЖЕТ И НЕ ОТВЕТИТЬ, и тогда мы не падаем. Именно за падение отвергнут
// `CurrencyManager.format` из jssdk: он **бросает** `UnhandledMatchError` на валюту, которой на
// портале нет, — а валюту мы берём из ВЫПИСКИ, а не из CRM, поэтому рублёвый платёж на портале с
// одной BYN уронил бы запись дела целиком. Здесь неизвестная валюта и недоступный справочник дают
// запасной вид «1 840,50 BYN»: хуже подписью, но дело записано.

/** Как портал описывает одну валюту. Нужны ровно два поля из `crm.currency.list`. */
export interface PortalCurrencyFormat {
  /** Шаблон с плейсхолдером `#` на месте числа, напр. `# руб.` или `$#`. */
  formatString: string
  /** Сколько знаков после запятой. */
  decimals: number
}

/** Справочник валют портала: код → формат. */
export type PortalCurrencyFormats = Record<string, PortalCurrencyFormat>

/** Именованные сущности, которые встречаются в шаблонах валют Bitrix24. Список КОРОТКИЙ и закрытый:
 *  общий HTML-декодер здесь был бы лишней поверхностью — строка приходит из справочника портала,
 *  а не от пользователя, и набор подписей у валют конечен. */
const NAMED_ENTITIES: Record<string, string> = {
  euro: '€', pound: '£', yen: '¥', cent: '¢', dollar: '$', nbsp: ' ', amp: '&'
}

/**
 * Раскрыть HTML-сущности в подписи валюты (`&#8381;` → `₽`, `&euro;` → `€`).
 *
 * ⚠ Числовая форма разбирается и в десятичном, и в шестнадцатеричном виде: у Bitrix встречается
 * `&#8381;`, но гарантий, что не появится `&#x20BD;`, нет никаких.
 */
export function decodeEntities(value: string): string {
  // Один проход одной регуляркой: раскрытое значение не раскрывается повторно (`&amp;#8381;` → `&#8381;`,
  // а не `₽`). Кодовая точка вне 0..0x10FFFF или суррогат — сущность остаётся как есть, без исключения.
  return value.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (whole, hex?: string, dec?: string, name?: string) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? whole
    const code = hex ? Number.parseInt(hex, 16) : Number.parseInt(dec!, 10)
    if (!Number.isSafeInteger(code) || code < 0 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) return whole
    return String.fromCodePoint(code)
  })
}

/** Число по-русски: неразрывный пробел между разрядами, запятая перед копейками. */
function formatNumber(value: number, decimals: number): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals
  }).format(Number.isFinite(value) ? value : 0)
}

/**
 * Подставить число в шаблон портала.
 *
 * ⚠ Плейсхолдер `#` заменяется НЕ напрямую: сама подпись бывает сущностью `&#8381;`, где решётка
 * стоит второй, и наивный `replace('#', …)` подставил бы число ВНУТРЬ кода символа, превратив
 * «29,00 ₽» в мусор. Экранируем `&#` на время замены — тот же приём, что у самого SDK.
 */
export function applyFormatString(formatString: string, formattedNumber: string): string {
  // \u0000 экранированием, а не литералом: сырые NUL-байты делают исходник «бинарным»
  // для grep и прочих инструментов, хотя как страж работают.
  const GUARD = '\u0000ENT\u0000'
  const guarded = formatString.replaceAll('&#', GUARD)
  const filled = guarded.includes('#')
    ? guarded.replace('#', formattedNumber)
    // Шаблон без плейсхолдера — такого быть не должно, но молча потерять СУММУ нельзя.
    : `${formattedNumber} ${guarded}`.trim()
  return decodeEntities(filled.replaceAll(GUARD, '&#')).trim()
}

/**
 * Сумма с валютой для экранов ЛК. `formats` — справочник портала (`crm.currency.list`); пустой или без
 * нужной валюты ⇒ запасной вид: BYN — «524,16 руб.» (как у портала), прочие — кодом «19,82 USD».
 */
export function formatAmountWithPortal(amount: number, currency: string, formats?: PortalCurrencyFormats): string {
  const code = (currency ?? '').trim().toUpperCase()
  const known = code && formats ? formats[code] : undefined
  if (known && known.formatString) {
    // Справочник приходит с портала: любой сбой разбора шаблона — запасной вид, а не упавшая страница.
    try {
      return applyFormatString(known.formatString, formatNumber(amount, known.decimals))
    }
    catch { /* запасной вид ниже */ }
  }
  const number = formatNumber(amount, 2)
  if (code === 'BYN') return `${number} руб.`
  return code ? `${number} ${code}` : number
}

/** Строки `crm.currency.list` → справочник; строки без кода или шаблона пропускаются. */
export function parseCurrencyList(rows: unknown): PortalCurrencyFormats {
  const formats: PortalCurrencyFormats = {}
  if (!Array.isArray(rows)) return formats
  for (const raw of rows as Record<string, unknown>[]) {
    const code = String(raw?.CURRENCY ?? '').trim().toUpperCase()
    const formatString = String(raw?.FORMAT_STRING ?? '').trim()
    if (!code || !formatString) continue
    const decimals = Number(raw?.DECIMALS)
    formats[code] = { formatString, decimals: Number.isInteger(decimals) && decimals >= 0 ? decimals : 2 }
  }
  return formats
}
