export default defineEventHandler((event) => {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
  // Сохранённый каталог (цены договора) и корзина — с устройства долой, даже если страница не
  // успела стереть их сама: `storage` чистит Cache Storage сервис-воркера и localStorage.
  setHeader(event, 'Clear-Site-Data', '"cache", "storage"')
  return { ok: true }
})
