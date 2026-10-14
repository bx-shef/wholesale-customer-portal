// Битрикс24 открывает обработчики встройки POST-запросом, а страницы Nuxt отвечают на GET.
// Переводим на GET того же адреса: токен фрейм берёт у портала сам (window.name + postMessage).
//
// Установка (/b24/install) — особый случай: только в этом POST коробка присылает токены
// приложения. Принимаем их (server/utils/b24AppAuth.ts: портал из B24_PORTAL_HOST, токен
// продлевается нашим секретом), сохраняем и в фоне настраиваем CRM. Итог — параметром `app`
// для страницы установки; причину отказа видно и в логе сервера.
import { acceptInstall, loadAppAuth, parseInstallPayload, saveAppAuth } from '../../utils/b24AppAuth'
import { allowedHosts } from '../../utils/managerTab'
import { runSetup } from '../../../shared/b24SetupRun'

let setupRunning = false

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  if (!/^\/b24\/(company-tab|install)$/.test(url.pathname)) throw createError({ statusCode: 404 })
  if (url.pathname !== '/b24/install') return sendRedirect(event, url.pathname + url.search, 303)

  const payload = parseInstallPayload(await readBody(event).catch(() => null), getQuery(event))
  let app = 'error'
  if (payload) {
    const db = useDb()
    const result = await acceptInstall(payload, {
      allowedHosts: allowedHosts(readServerEnv().b24PortalHosts, loadAppAuth(db)?.domain),
      creds: appCreds(),
      fetch: (u, body) => fetch(u, { method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(15_000) }),
    })
    if (result.ok) {
      saveAppAuth(db, result.auth)
      app = 'ok'
      console.info(`[b24-install] app installed on ${result.auth.domain}`)
      // CRM настраивается в фоне: установка не ждёт десятков вызовов. Повтор — make b24-setup.
      // Один прогон за раз: два параллельных «прочитал → создал» (повтор установки, ретрай
      // коробки) создали бы смарт-процессы дважды.
      if (!setupRunning) {
        setupRunning = true
        Promise.resolve()
          .then(() => runSetup(useB24Call(), true))
          .then(r => console.info(`[b24-setup] ${r.done ? 'done' : 'not finished'}: ${r.lines.length} calls${r.pending.length ? `; pending: ${r.pending.join('; ')}` : ''}`))
          .catch(e => console.error(`[b24-setup] ${(e as Error).message}`))
          .finally(() => { setupRunning = false })
      }
    }
    else {
      console.error(`[b24-install] rejected: ${result.reason}`)
    }
  }
  else {
    console.error('[b24-install] no install payload (AUTH/REFRESH_ID/member_id/DOMAIN)')
  }
  const q = new URLSearchParams(url.search)
  q.set('app', app)
  return sendRedirect(event, `/b24/install?${q}`, 303)
})
