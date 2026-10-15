// «Состояние системы» — данные для страницы: обмен с 1С, база, защита 1С. Тот же пароль, что у стенда.
export default defineEventHandler((event) => {
  guardOnecTest(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return currentSystemStatus()
})
