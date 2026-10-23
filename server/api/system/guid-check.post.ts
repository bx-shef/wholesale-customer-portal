// Сверка последних компаний коробки с подключённой 1С (кнопка на «Состоянии системы»). Только чтение.
export default defineEventHandler(async (event) => {
  guardOnecTest(event)
  if (!b24Configured()) throw createError({ statusCode: 409, message: 'Приложение в коробке не установлено' })
  const onec = useOnec()
  return { rows: await checkCompanyGuids(useB24Call(), guid => onec.clientByGuid(guid)) }
})
