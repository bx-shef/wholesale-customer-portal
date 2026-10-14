/** Формы ответов каталога для экранов — одно описание для сервера и страниц. */
export type PriceStatus = 'ok' | 'no-contract' | 'unavailable'

export interface ItemPriceView { value: number, currency: string, vatRate: number }

export interface CatalogItemView {
  guid: string
  sku: string
  name: string
  sectionGuid: string
  brand: string
  unit: string
  packQty: number
  minQty: number
  available: number
  image: string | null
  price: ItemPriceView | null
}

export interface CatalogPageView { items: CatalogItemView[], total: number, priceStatus: PriceStatus }

export interface CatalogItemDetailsView extends CatalogItemView {
  description: string
  properties: Record<string, string>
  images: string[]
  stock: { warehouseGuid: string, warehouseName: string, available: number }[]
  analogs: CatalogItemView[]
}

/** Подпись цены, когда её нет: «нет договора» и «не ответила система» — разные вещи для клиента. */
export function missingPriceText(status: PriceStatus): string {
  if (status === 'no-contract') return 'Цены появятся после подключения договора — обратитесь к менеджеру'
  if (status === 'unavailable') return 'Цена временно недоступна'
  return 'Цена по запросу у менеджера'
}
