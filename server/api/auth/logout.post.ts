import { CONTRACT_COOKIE } from '../../../shared/contractChoice'

export default defineEventHandler((event) => {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
  // Выбранное соглашение (#46) — следующему вошедшему на этом устройстве не нужно.
  deleteCookie(event, CONTRACT_COOKIE, { path: '/' })
  // Сохранённый каталог (цены договора) и корзина — с устройства долой, даже если страница не
  // успела стереть их сама: `storage` чистит Cache Storage сервис-воркера и localStorage.
  setHeader(event, 'Clear-Site-Data', '"cache", "storage"')
  return { ok: true }
})
