/**
 * Экран данных клиента из 1С: что показать по ответу `/api/client-data`. Чистые правила — под тестом.
 */
export type ClientDataStatus = 'fresh' | 'loaded' | 'stale' | 'missing' | 'error' | 'crm_unavailable'
export interface ClientDataResponse {
  status: ClientDataStatus
  loadedAt: string | null
  hasContract: boolean
  /** Действующие соглашения для выбора в корзине (#46). */
  contracts?: Array<{ guid: string, label: string }>
  selected?: string | null
}

/** Страницы клиента, которым нужны его данные из 1С. Вход, справка и коробка — без них. */
export function isClientRoute(path: string): boolean {
  return path === '/' || path === '/cart' || path === '/orders' || path === '/profile' || path.startsWith('/product/')
}

export const NO_CONTRACT_MESSAGE = 'Цены и заказ недоступны: нет действующего соглашения. Обратитесь к менеджеру.'

/** Дата и время по Минску, как в остальных экранах ЛК. */
export function minskTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Minsk', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export interface ClientDataView {
  /** Кабинет не показываем — только сообщение. */
  block: boolean
  message: string
  retry: boolean
}

export function clientDataView(r: ClientDataResponse | null): ClientDataView {
  if (!r) return { block: false, message: '', retry: false }
  if (r.status === 'error') return { block: true, message: 'Учётная система сейчас не отвечает, ваших данных у нас ещё нет. Повторите через несколько минут.', retry: true }
  if (r.status === 'crm_unavailable') return { block: true, message: 'Не удалось проверить вашу компанию. Повторите через несколько минут.', retry: true }
  if (r.status === 'missing') return { block: true, message: 'Ваша компания не найдена в учётной системе. Обратитесь к менеджеру.', retry: true }
  const stale = r.status === 'stale' && r.loadedAt ? `Учётная система не отвечает: данные на ${minskTime(r.loadedAt)}.` : ''
  const contract = r.hasContract ? '' : NO_CONTRACT_MESSAGE
  return { block: false, message: [stale, contract].filter(Boolean).join(' '), retry: false }
}
