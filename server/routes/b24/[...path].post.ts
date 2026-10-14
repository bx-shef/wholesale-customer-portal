// Битрикс24 открывает обработчик встройки POST-запросом, а страницы Nuxt отвечают на GET.
// Переводим на GET того же адреса: токен фрейм берёт у портала сам (window.name + postMessage),
// тело POST ему не нужно и дальше не идёт.
export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  if (!/^\/b24\/(company-tab|install)$/.test(url.pathname)) throw createError({ statusCode: 404 })
  return sendRedirect(event, url.pathname + url.search, 303)
})
