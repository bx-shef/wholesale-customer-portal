// Страница «Состояние системы»: обмен с 1С, база ЛК, оповещения, проверка синхронизации на моке.
import { SYSTEM_PAGE } from '../../utils/systemPage'

export default defineEventHandler((event) => {
  guardOnecTest(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return SYSTEM_PAGE
})
