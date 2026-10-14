/**
 * REST портала от имени сотрудника — токеном фрейма вкладки (docs/spec.md §3). Хост уже сверен
 * со списком доверенных (`managerTab.ts`): сюда не приходит адрес, выбранный браузером.
 * Ответ портала наружу не отдаём — только «получилось» или исключение.
 */
import type { UserCall } from './managerTab'

const TIMEOUT_MS = 10_000

export const portalUserCall: UserCall = async (host, authId, method, params) => {
  if (!/^[a-z0-9.]+$/.test(method)) throw new Error(`bad method ${method}`)
  const res = await fetch(`https://${host}/rest/${method}.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...params, auth: authId }),
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const data = await res.json().catch(() => null) as { result?: unknown, error?: string } | null
  if (!res.ok || !data || data.error) throw new Error(`B24 user ${method}: ${res.status} ${data?.error ?? ''}`)
  return data.result
}
