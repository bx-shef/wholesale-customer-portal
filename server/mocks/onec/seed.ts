/**
 * Детерминированные данные мока 1С (docs/spec.md §6): 5 клиентов, 3 типа цен, 2 склада,
 * 12 разделов, 500 товаров со связями «аналог». Один seed — одни и те же GUID, цены и остатки
 * на любой машине: контрактные тесты и демо опираются на повторяемость.
 */
import type { ClientT, ContractT, DeliveryScheduleT, ItemT, SectionT } from '../../../shared/onec/schemas'

/** Момент «до всех изменений»: changedAt сида лежат после него, changedSince=SEED_EPOCH отдаёт всё. */
import { createHash } from 'node:crypto'
import { ALGENA_DRY_MIXES } from './algena'
import { DEMO_IMAGES_JPEG } from './demoImages'

/** mulberry32 — маленький детерминированный ГПСЧ; криптостойкость здесь не нужна. */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** GUID из ГПСЧ: формат 1С (8-4-4-4-12), версия 4. */
export function guidFrom(rand: () => number): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16)).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${'89ab'[Math.floor(rand() * 4)]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export interface PriceType { guid: string, name: string, coefficient: number }
export interface Warehouse { guid: string, name: string }

export interface SeedData {
  priceTypes: PriceType[]
  warehouses: Warehouse[]
  clients: ClientT[]
  /** График доставки по бизнес-регионам (§2.8): регион — город. */
  schedules: DeliveryScheduleT[]
  contracts: ContractT[]
  sections: SectionT[]
  items: ItemT[]
  /** Базовая цена товара (без коэффициента типа цен), с НДС. */
  basePrice: Map<string, number>
  /** Остаток: ключ `itemGuid|warehouseGuid`. */
  stock: Map<string, number>
  /** Картинки для `GET /image/{id}`: версия и base64. */
  images: Map<string, { hash: string, data: string }>
}

export const SEED_EPOCH = '2026-01-01T00:00:00.000Z'
const DAY = 86_400_000

const CITIES = ['Минск', 'Гомель', 'Брест', 'Гродно', 'Витебск', 'Могилёв']
const BRANDS = ['Ceresit', 'Knauf', 'Caparol', 'Tikkurila', 'Bosch', 'Makita', 'Grohe', 'Rehau']
const UNITS = ['шт', 'кг', 'м', 'упак', 'л']
const SECTION_NAMES = ['Сухие смеси', 'Краски', 'Грунтовки', 'Инструмент', 'Электроинструмент', 'Сантехника',
  'Трубы и фитинги', 'Крепёж', 'Утеплители', 'Гипсокартон', 'Клеи и герметики', 'Расходники']

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * `demoClients` — GUID настоящих компаний CRM (`ONEC_MOCK_CLIENTS`): мок заводит им клиента с
 * демо-договором и адресом, иначе на стенде у реальной компании нет ни цен, ни корзины.
 * `demoChangedAt` — их changedAt.
 */
export function generateSeed(seed = 1, demoClients: string[] = [], demoChangedAt = SEED_EPOCH): SeedData {
  const rand = prng(seed)
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)]!
  const at = (days: number) => new Date(Date.parse(SEED_EPOCH) + days * DAY).toISOString()

  const priceTypes: PriceType[] = [
    { guid: guidFrom(rand), name: 'Оптовая', coefficient: 1 },
    { guid: guidFrom(rand), name: 'Крупный опт', coefficient: 0.93 },
    { guid: guidFrom(rand), name: 'Дилер', coefficient: 0.87 },
  ]
  const warehouses: Warehouse[] = [
    { guid: guidFrom(rand), name: 'Склад Минск' },
    { guid: guidFrom(rand), name: 'Склад Гомель' },
  ]

  // Регионы и график — своим генератором: GUID остальных записей от них не зависят.
  const regionRand = prng(seed ^ 0x4e9)
  const schedules: DeliveryScheduleT[] = CITIES.map((name, i) => ({
    regionGuid: guidFrom(regionRand),
    regionName: name,
    weekdays: i === 0 ? [1, 2, 3, 4, 5] : [[2, 5], [1, 4], [3], [2, 4], [5]][(i - 1) % 5]!,
    cutoffDaysBefore: 1,
    cutoffTime: '15:00',
    arrivalFrom: i === 0 ? '09:00' : '10:00',
    arrivalTo: i === 0 ? '13:00' : '16:00',
    exceptions: [],
  }))
  const regionOf = (city: string) => {
    const s = schedules.find(x => x.regionName === city)!
    return { guid: s.regionGuid, name: s.regionName }
  }

  const contracts: ContractT[] = []
  const clients: ClientT[] = []
  for (let i = 0; i < 5; i++) {
    const contract: ContractT = {
      guid: guidFrom(rand),
      number: `ОПТ-${String(i + 1).padStart(3, '0')}/2026`,
      date: at(i * 3).slice(0, 10),
      priceTypeGuid: priceTypes[i % priceTypes.length]!.guid,
      paymentDelayDays: [0, 14, 30][i % 3]!,
      creditLimit: round2(5000 + i * 2500),
      debt: round2(rand() * 3000),
      currency: 'BYN',
    }
    contracts.push(contract)
    const city = CITIES[i % CITIES.length]!
    clients.push({
      guid: guidFrom(rand),
      name: `ООО «Стройклиент ${i + 1}»`,
      unp: String(190000000 + Math.floor(rand() * 9_999_999)),
      address: `г. ${city}, ул. Складская, ${i + 1}`,
      city,
      region: regionOf(city),
      // Пятый клиент — в сегменте запрета отгрузки: заявку ЛК принимает, отгрузку решает 1С.
      shipmentBlocked: i === 4,
      managerEmail: `manager${(i % 2) + 1}@example.by`,
      contract,
      deliveryAddresses: [{ guid: guidFrom(rand), city, address: `г. ${city}, ул. Строителей, ${10 + i}` }],
      changedAt: at(1 + i),
      deleted: false,
    })
  }

  // После основного сида: случайные GUID остальных записей от демо-клиентов не зависят.
  for (const [i, guid] of demoClients.entries()) {
    clients.push({
      guid,
      name: `Демо-клиент ${i + 1}`,
      unp: '190000000',
      address: 'г. Минск, ул. Складская, 1',
      city: 'Минск',
      region: regionOf('Минск'),
      shipmentBlocked: false,
      managerEmail: '',
      contract: contracts[0]!,
      deliveryAddresses: [{ guid: guidFrom(prng(i + 1000)), city: 'Минск', address: 'г. Минск, ул. Строителей, 1' }],
      // Время запуска процесса: синхронизация по курсору иначе не заметила бы GUID, добавленный позже.
      changedAt: demoChangedAt,
      deleted: false,
    })
  }

  const sections: SectionT[] = []
  for (const [i, name] of SECTION_NAMES.entries()) {
    // Первые четыре — корневые, остальные — подразделы: дерево проверяет parentGuid.
    sections.push({ guid: guidFrom(rand), parentGuid: i < 4 ? null : sections[i % 4]!.guid, name })
  }

  // Картинки витрины — по порядку к товарам algena.by, у которых картинка есть.
  const images = new Map<string, { hash: string, data: string }>()
  let nextImage = 0
  const items: ItemT[] = []
  function addImage(data: string) {
    const id = `img-${images.size + 1}`
    const hash = createHash('sha1').update(data).digest('hex')
    images.set(id, { hash, data })
    return { id, hash }
  }
  const basePrice = new Map<string, number>()
  for (let i = 0; i < 500; i++) {
    const section = sections[i % sections.length]!
    const brand = pick(BRANDS)
    const packQty = pick([1, 1, 5, 10, 25])
    // Первые товары раздела «Сухие смеси» — настоящие с algena.by: имя, цена, картинка.
    const demo = i % sections.length === 0 ? ALGENA_DRY_MIXES[i / sections.length] : undefined
    const item: ItemT = {
      guid: guidFrom(rand),
      sku: `A-${String(10000 + i)}`,
      name: demo?.name ?? `${section.name}: ${brand} модель ${100 + i}`,
      sectionGuid: section.guid,
      brand,
      unit: demo ? (pick(UNITS), 'шт') : pick(UNITS),
      packQty: demo ? 1 : packQty,
      minQty: demo ? 1 : packQty,
      description: `Товар раздела «${section.name}» бренда ${brand}.`,
      properties: { Страна: pick(['Беларусь', 'Германия', 'Польша', 'Россия']), Вес: `${Math.ceil(rand() * 30)} кг` },
      images: demo?.image && nextImage < DEMO_IMAGES_JPEG.length ? [addImage(DEMO_IMAGES_JPEG[nextImage++]!)] : [],
      analogs: [],
      // Товары витрины появились позже основного сида: уже заполненный индекс их подтянет.
      changedAt: demo ? at(287) : at(10 + (i % 60)),
      deleted: false,
    }
    items.push(item)
    const random = round2(2 + rand() * 300)
    basePrice.set(item.guid, demo ? demo.price : random)
  }
  // Аналоги — товары того же раздела другого бренда: связь двусторонняя, как в справочнике 1С.
  for (const item of items) {
    const peers = items.filter(o => o.sectionGuid === item.sectionGuid && o.brand !== item.brand && o.guid !== item.guid)
    for (const peer of peers.slice(0, 2)) {
      if (!item.analogs.includes(peer.guid)) item.analogs.push(peer.guid)
      if (!peer.analogs.includes(item.guid)) peer.analogs.push(item.guid)
    }
  }

  const stock = new Map<string, number>()
  for (const item of items) {
    for (const warehouse of warehouses) {
      // Примерно каждый пятый — нет на складе: каталог должен уметь показывать «нет в наличии».
      stock.set(`${item.guid}|${warehouse.guid}`, rand() < 0.2 ? 0 : Math.floor(rand() * 400))
    }
  }

  return { schedules, priceTypes, warehouses, clients, contracts, sections, items, basePrice, stock, images }
}
