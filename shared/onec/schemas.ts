/**
 * Контракт HTTP-сервиса 1С (docs/onec-contract.md) — единственный источник. Из этих схем
 * собирается `contracts/onec.openapi.yaml` (`pnpm onec:openapi`), по ним клиент ЛК проверяет
 * ответы, а мок — что отдаёт ровно то, что обещано. Поменять контракт = поменять этот файл PR'ом.
 */
import { z } from 'zod'

/** GUID ссылки 1С — 36 символов с дефисами, регистр не важен. */
export const Guid = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)
/** Дата-время ISO 8601 с зоной. */
export const DateTime = z.iso.datetime({ offset: true })
/** Дата ISO 8601 без времени. */
export const DateOnly = z.iso.date()
/** Сумма: число с не более чем двумя знаками после точки. */
export const Money = z.number().refine(v => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'не больше двух знаков после точки')
export const Currency = z.string().regex(/^[A-Z]{3}$/)

export const ErrorBody = z.object({ error: z.string().min(1), message: z.string() })

export const PAGE_SIZE_MAX = 500

/** Страница списка: `nextPage` — номер следующей страницы или null на последней. */
export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextPage: z.number().int().positive().nullable() })
}

export const ListQuery = z.object({
  changedSince: DateTime.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(PAGE_SIZE_MAX).default(PAGE_SIZE_MAX),
})

export const DeliveryAddress = z.object({ guid: Guid, city: z.string(), address: z.string() })

export const Contract = z.object({
  guid: Guid,
  /** Наименование соглашения в 1С — по нему клиент выбирает соглашение в корзине (#46). */
  name: z.string().default(''),
  number: z.string(),
  date: DateOnly,
  priceTypeGuid: Guid,
  paymentDelayDays: z.number().int().nonnegative(),
  creditLimit: Money,
  debt: Money,
  currency: Currency,
})

/** Бизнес-регион клиента в 1С: по нему — график доставки (§2.8). */
export const Region = z.object({ guid: Guid, name: z.string() })

export const Client = z.object({
  guid: Guid,
  name: z.string(),
  unp: z.string(),
  address: z.string(),
  city: z.string(),
  /** Бизнес-регион; `null` — не задан, дату доставки клиенту не обещаем. */
  region: Region.nullable(),
  /** Клиент в сегменте запрета отгрузки: заявку ЛК принимает, отгрузку решает 1С. Только для показа. */
  shipmentBlocked: z.boolean(),
  managerEmail: z.string(),
  /** Договор для заказов из ЛК; `null` — договора нет, цен клиенту не показываем. */
  contract: Contract.nullable(),
  /** Все действующие соглашения клиента, первое — `contract` (по умолчанию); выбор в корзине — #46. */
  contracts: z.array(Contract).default([]),
  deliveryAddresses: z.array(DeliveryAddress),
  changedAt: DateTime,
  deleted: z.boolean(),
})


/** Ссылка на картинку товара: сам файл — `GET /image/{id}` в base64 (docs/onec-contract.md §2.8). */
export const ImageRef = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), hash: z.string().regex(/^[A-Za-z0-9]{1,64}$/) })
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const ImageFile = z.object({
  id: ImageRef.shape.id,
  hash: ImageRef.shape.hash,
  contentType: z.enum(IMAGE_TYPES),
  // base64 без переносов и префикса data:; 5 МБ файла — до ~7 МБ строки.
  data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/).max(Math.ceil(IMAGE_MAX_BYTES / 3) * 4),
})

/** Раздел ЛК — вид номенклатуры 1С (решение владельца, docs/onec-contract.md §2.3). */
export const Section = z.object({ guid: Guid, parentGuid: Guid.nullable(), name: z.string() })

export const Item = z.object({
  guid: Guid,
  sku: z.string(),
  name: z.string(),
  sectionGuid: Guid,
  brand: z.string(),
  unit: z.string(),
  packQty: z.number().positive(),
  minQty: z.number().positive(),
  description: z.string(),
  properties: z.record(z.string(), z.string()),
  images: z.array(ImageRef),
  analogs: z.array(Guid),
  changedAt: DateTime,
  deleted: z.boolean(),
})

/** Каталог: разделы приходят целиком на первой странице, товары — постранично. */
export const CatalogPage = z.object({ sections: z.array(Section), items: z.array(Item), nextPage: z.number().int().positive().nullable() })

/** Строка прайса: цена товара по виду цен (§2.4); ЛК хранит прайс и считает цену клиента сам. */
export const Price = z.object({
  priceTypeGuid: Guid,
  itemGuid: Guid,
  price: Money,
  currency: Currency,
  vatRate: z.number().nonnegative(),
  changedAt: DateTime,
  deleted: z.boolean(),
})

export const Stock = z.object({
  itemGuid: Guid,
  warehouseGuid: Guid,
  warehouseName: z.string(),
  available: z.number().nonnegative(),
  changedAt: DateTime,
})

export const OrderStatus = z.enum(['new', 'confirmed', 'assembled', 'shipped', 'delivered', 'cancelled'])

export const OrderRequest = z.object({
  /** ID сделки Б24: повтор с тем же externalId возвращает уже созданный заказ. */
  externalId: z.string().min(1).max(64),
  clientGuid: Guid,
  contractGuid: Guid,
  deliveryAddressGuid: Guid,
  /** Новый адрес, которого нет у партнёра в 1С (#124): текстом в «Адрес доставки» заказа; GUID — запасной адрес партнёра. */
  deliveryAddressText: z.string().trim().min(1).max(300).optional(),
  deliveryDate: DateOnly,
  comment: z.string().max(2000).default(''),
  /** Заказ со стенда проверки (docs/onec-contract.md §1.7): 1С проверяет всё, документ не создаёт или помечает. */
  test: z.boolean().optional(),
  items: z.array(z.object({ itemGuid: Guid, qty: z.number().positive(), price: Money })).min(1).max(PAGE_SIZE_MAX),
})
/** Факт по строке заказа (§2.6): цена, с которой заказ принят, и сколько зарезервировано. */
export const OrderLineFact = z.object({ itemGuid: Guid, price: Money, reserved: z.number().nonnegative() })
export const OrderCreated = z.object({ orderGuid: Guid, number: z.string().min(1).max(64), status: OrderStatus, items: z.array(OrderLineFact) })

export const OrderStatusRow = z.object({
  orderGuid: Guid,
  externalId: z.string(),
  number: z.string().min(1).max(64),
  status: OrderStatus,
  shipmentDate: DateOnly.nullable(),
  /** Задание на перевозку (§2.9), в которое попал заказ; `null` — ещё не запланирован. */
  tripGuid: Guid.nullable(),
  /**
   * Доставка подтверждена (решение клиента 2026-10-27): заказ «К выполнению», состояние «Готов к
   * закрытию», расходный ордер «К отгрузке», задание на перевозку «Закрыто». Тогда клиенту — день приезда.
   */
  deliveryConfirmed: z.boolean().default(false),
  changedAt: DateTime,
})

/** `ЧЧ:ММ` по Минску. */
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

/** График доставки по бизнес-региону (§2.8): ведёт логист в 1С, ЛК только читает. */
export const DeliverySchedule = z.object({
  regionGuid: Guid,
  regionName: z.string(),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  cutoffDaysBefore: z.number().int().min(0).max(14),
  cutoffTime: ClockTime,
  arrivalFrom: ClockTime,
  arrivalTo: ClockTime,
  exceptions: z.array(DateOnly).max(366),
})
export const DeliverySchedulePage = z.object({ items: z.array(DeliverySchedule).max(PAGE_SIZE_MAX) })

export const TripStatus = z.enum(['forming', 'loading', 'sent', 'closed'])

/** Задание на перевозку (§2.9): рейс с заказами. Водителя и экспедитора 1С не передаёт. */
export const Trip = z.object({
  guid: Guid,
  number: z.string().min(1).max(64),
  status: TripStatus,
  plannedStart: DateTime,
  plannedEnd: DateTime.nullable(),
  actualStart: DateTime.nullable(),
  actualEnd: DateTime.nullable(),
  vehicle: z.string(),
  regionGuids: z.array(Guid),
  orders: z.array(z.object({ orderGuid: Guid, number: z.string().min(1).max(64), clientGuid: Guid })),
  changedAt: DateTime,
  deleted: z.boolean(),
})

export const ClientsPage = page(Client)
export const StockPage = page(Stock)
export const OrderStatusPage = page(OrderStatusRow)
export const PricesPage = page(Price)
export const TripsPage = page(Trip)

export type ClientT = z.infer<typeof Client>
export type ContractT = z.infer<typeof Contract>
export type SectionT = z.infer<typeof Section>
export type ItemT = z.infer<typeof Item>
export type ImageRefT = z.infer<typeof ImageRef>
export type ImageFileT = z.infer<typeof ImageFile>
export type PriceT = z.infer<typeof Price>
export type StockT = z.infer<typeof Stock>
export type OrderStatusT = z.infer<typeof OrderStatus>
export type OrderRequestT = z.input<typeof OrderRequest>
export type OrderCreatedT = z.infer<typeof OrderCreated>
export type OrderLineFactT = z.infer<typeof OrderLineFact>
export type OrderStatusRowT = z.infer<typeof OrderStatusRow>
export type RegionT = z.infer<typeof Region>
export type DeliveryScheduleT = z.infer<typeof DeliverySchedule>
export type TripT = z.infer<typeof Trip>
export type TripStatusT = z.infer<typeof TripStatus>

/** Коды ошибок контракта: HTTP-код и `error` в теле. */
export const ERROR_CODES = {
  unauthorized: 401,
  not_found: 404,
  conflict: 409,
  validation: 400,
  unavailable: 503,
  internal: 500,
} as const
export type ErrorCode = keyof typeof ERROR_CODES
