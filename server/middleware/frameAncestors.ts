// Страницы приложения коробки (/b24/*) встраиваются во фрейм портала — разрешаем это только
// порталу из B24_PORTAL_HOST. Остальной ЛК встраивать нельзя никому: подложенный во фрейм вход
// — классический clickjacking. На ВМ X-Frame-Options от bitrix-env для /b24/ снимает
// deploy/bitrixvm/00-app-proxy.conf; решение «кому можно» остаётся здесь.
import { frameAncestorsPolicy } from '../utils/frameAncestors'

export default defineEventHandler((event) => {
  setHeader(event, 'Content-Security-Policy', frameAncestorsPolicy(event.path, readServerEnv().b24PortalHosts))
})
