/**
 * Битрикс24 коробки поставщика для сервера ЛК — B24Hook по B24_WEBHOOK_URL (docs/spec.md §2):
 * браузер к порталу не ходит. Один клиент на процесс; без вебхука — 503 с понятной причиной.
 */
import { B24Hook } from '@bitrix24/b24jssdk'
import { createB24AccessDirectory, type AccessDirectory, type B24Call } from '../services/b24Access'

let hook: { url: string, b24: B24Hook } | undefined
let directory: { url: string, dir: AccessDirectory } | undefined

export function useB24Call(): B24Call {
  const url = readServerEnv().b24WebhookUrl
  if (!url) throw createError({ statusCode: 503, message: 'Bitrix24 is not configured: B24_WEBHOOK_URL' })
  if (hook?.url !== url) hook = { url, b24: B24Hook.fromWebhookUrl(url) }
  const b24 = hook.b24
  return async (method, params) => {
    const response = await b24.actions.v2.call.make({ method, params })
    // Текст ошибки портала — в лог сервера, наружу не уходит. Адрес вебхука — секрет: вырезаем.
    if (!response.isSuccess) throw new Error(`B24 ${method}: ${response.getErrorMessages().join('; ').replaceAll(url, '<webhook>')}`)
    return response.getData()!.result
  }
}

export function useAccessDirectory(): AccessDirectory {
  const url = readServerEnv().b24WebhookUrl
  if (directory?.url !== url) directory = { url, dir: createB24AccessDirectory((m, p) => useB24Call()(m, p)) }
  return directory.dir
}
