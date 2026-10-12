/**
 * Правила корзины — одни для экрана и сервера. Сервер пересчитывает всё сам: цена и количество
 * из браузера — только пожелание (docs/spec.md §2: клиент не видит и не задаёт чужих цен).
 */
export interface CartLineInput { guid: string, qty: number }

export const CART_LINES_MAX = 200
export const COMMENT_MAX = 2000

/** Количество кратно упаковке и не меньше минимума: ближайшее допустимое не меньше запрошенного. */
export function normalizeQty(qty: number, packQty: number, minQty: number): number {
  // В целых тысячных: 0.1 × 3 в двоичной арифметике — 0.30000000000000004, и ceil добавил бы упаковку.
  const pack = Math.max(Math.round((packQty > 0 ? packQty : 1) * 1000), 1)
  const want = Math.max(Math.round(qty * 1000), Math.round(minQty * 1000), pack)
  return (Math.ceil(want / pack) * pack) / 1000
}

export function isValidQty(qty: number, packQty: number, minQty: number): boolean {
  return Number.isFinite(qty) && qty > 0 && normalizeQty(qty, packQty, minQty) === roundQty(qty)
}

/** Количество — до тысячных: сумма дробных упаковок не тянет хвост двоичной погрешности. */
export const roundQty = (qty: number) => Math.round(qty * 1000) / 1000

/** Сумма строки до копеек. */
export const lineTotal = (price: number, qty: number) => Math.round(price * qty * 100) / 100

/** Адрес одной строкой: город не повторяем, если 1С уже вписала его в адрес. */
export function addressLine(city: string, address: string): string {
  return address.toLowerCase().includes(city.trim().toLowerCase()) ? address : `${city}, ${address}`
}

/** Дата и время рейса для людей — по Минску (сделку читает менеджер, а не программа). */
export function humanDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Minsk', weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

/** Комментарий клиента уходит в сделку, где поддерживаются BB-коды: скобки — полноширинные. */
export function neutralizeBb(text: string): string {
  return text.replace(/\[/g, '［').replace(/\]/g, '］')
}
