// Сверка последних компаний коробки с подключённой 1С (кнопка на «Состоянии системы»). Только чтение;
// не чаще раза в минуту и не два разом — бережём 1С (до 5 точечных запросов на клик).
let running = false
let lastAt = 0

export default defineEventHandler(async (event) => {
  guardOnecTest(event)
  if (!b24Configured()) throw createError({ statusCode: 409, message: 'Приложение в коробке не установлено' })
  const env = readServerEnv()
  if (!env.onecMock && !env.onecUrl) throw createError({ statusCode: 409, message: '1С не настроена' })
  if (running) throw createError({ statusCode: 409, message: 'Сверка уже идёт' })
  if (Date.now() - lastAt < 60_000) throw createError({ statusCode: 429, message: 'Повторить можно через минуту' })
  running = true
  lastAt = Date.now()
  try {
    const onec = useOnec()
    return { rows: await checkCompanyGuids(useB24Call(), guid => onec.clientByGuid(guid)) }
  }
  finally {
    running = false
  }
})
