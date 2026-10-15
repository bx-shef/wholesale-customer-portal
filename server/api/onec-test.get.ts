// Страница стенда проверки 1С: форма адреса и токена, отчёт по проверкам. Только с паролем.
import { ONEC_TEST_PAGE } from '../utils/onecTestPage'

export default defineEventHandler((event) => {
  guardOnecTest(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return ONEC_TEST_PAGE
})
