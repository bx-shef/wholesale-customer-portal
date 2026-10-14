/**
 * Битрикс24 коробки поставщика для сервера ЛК — токеном локального приложения (docs/spec.md §2;
 * вебхук отменён 14.10.2026). Токены приходят при установке (`server/routes/b24/[...path].post.ts`),
 * лежат в SQLite и продлеваются SDK: новая пара сразу пишется обратно. Браузер к порталу не ходит.
 * Без установленного приложения — 503 с понятной причиной.
 */
import { B24OAuth } from '@bitrix24/b24jssdk'
import type { B24OAuthParams } from '@bitrix24/b24jssdk'
import { createB24AccessDirectory, type AccessDirectory, type B24Call } from '../services/b24Access'
import { loadAppAuth, saveAppAuth, type AppAuth, type AppCreds } from './b24AppAuth'

let client: { key: string, b24: B24OAuth } | undefined
let directory: AccessDirectory | undefined

export function appCreds(): AppCreds | null {
  const env = readServerEnv()
  return env.b24ClientId && env.b24ClientSecret ? { clientId: env.b24ClientId, clientSecret: env.b24ClientSecret } : null
}

/** Приложение установлено и ключи заданы — обмены с порталом возможны. */
export function b24Configured(): boolean {
  return Boolean(appCreds() && loadAppAuth(useDb()))
}

function oauthParams(a: AppAuth, now = Date.now()): B24OAuthParams {
  return {
    applicationToken: '',
    userId: 0,
    memberId: a.memberId,
    accessToken: a.accessToken,
    refreshToken: a.refreshToken,
    expires: Math.floor(a.expiresAt / 1000),
    expiresIn: Math.max(0, Math.floor((a.expiresAt - now) / 1000)),
    scope: '',
    domain: a.domain,
    clientEndpoint: `https://${a.domain}/rest/`,
    serverEndpoint: a.serverEndpoint,
    status: 'L',
  }
}

export function useB24Call(): B24Call {
  const creds = appCreds()
  const auth = loadAppAuth(useDb())
  if (!creds || !auth) throw createError({ statusCode: 503, message: 'Bitrix24 is not connected: install the local app (docs/DEPLOY_BITRIXVM.md)' })
  // Клиент живёт, пока в базе та же пара: после продления SDK пишет её туда, и следующий вызов
  // строит клиент заново из базы — переустановка приложения подхватывается так же.
  const key = `${auth.memberId}|${auth.refreshToken}`
  if (client?.key !== key) {
    const b24 = new B24OAuth(oauthParams(auth), creds)
    b24.setCallbackRefreshAuth(async ({ b24OAuthParams: p }) => {
      saveAppAuth(useDb(), { ...auth, accessToken: p.accessToken, refreshToken: p.refreshToken, expiresAt: p.expires * 1000 })
    })
    client = { key, b24 }
  }
  const b24 = client.b24
  return async (method, params) => {
    const response = await b24.actions.v2.call.make({ method, params })
    if (!response.isSuccess) throw new Error(`B24 ${method}: ${response.getErrorMessages().join('; ')}`)
    return response.getData()!.result
  }
}

export function useAccessDirectory(): AccessDirectory {
  // Транспорт берётся на каждый вызов: справочник переживает переустановку приложения.
  directory ??= createB24AccessDirectory((m, p) => useB24Call()(m, p))
  return directory
}
