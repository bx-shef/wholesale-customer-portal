// Прогрев форматов валют портала при старте: первый «кто вошёл» уже отдаёт «руб.» по шаблону портала.
// Сбой не мешает старту — `cached` его глотает и повторит позже.
import { portalCurrencies } from '../utils/portalDirectory'

export default defineNitroPlugin(() => {
  if (import.meta.prerender) return
  void portalCurrencies()
})
