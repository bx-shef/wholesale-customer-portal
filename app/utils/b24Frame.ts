/**
 * Фрейм Битрикс24 для служебных страниц /b24/* (вкладка компании, установка). Только в
 * браузере и только внутри портала: вне фрейма window.name пуст — честный отказ, а не зависание.
 */
import type { B24Frame } from '@bitrix24/b24jssdk'

export async function openB24Frame(): Promise<B24Frame> {
  if (!import.meta.client || !window.name) throw new Error('outside-portal')
  const { initializeB24Frame } = await import('@bitrix24/b24jssdk')
  // Токен уходит на наш сервер мимо SDK — без keepAuthFresh он протух бы в открытой вкладке.
  return initializeB24Frame({ keepAuthFresh: true })
}

/** ID компании из параметров встройки: портал присылает его строкой или числом. */
export function companyIdFromOptions(options: Readonly<Record<string, unknown>>): number | null {
  const id = Number(options.ID ?? options.id)
  return Number.isInteger(id) && id > 0 ? id : null
}
