// Живость процесса и коммит сборки — для make doctor, Watchtower и проверки после выката
// (docs/DEPLOY.md). Без секретов: только какие настройки заданы.
import { loadAppAuth } from '../utils/b24AppAuth'

export default defineEventHandler(() => {
  const env = readServerEnv()
  // База открывается (и мигрирует) здесь же: health упадёт, если том не смонтирован или не пишется.
  let db = false
  try {
    useDb().prepare('SELECT 1').get()
    db = true
  }
  catch (e) {
    console.error(`[db] ${(e as Error).message}`)
  }
  return {
    status: db ? 'ok' : 'degraded',
    commit: env.commitSha ? env.commitSha.slice(0, 7) : null,
    config: {
      b24App: db && Boolean(env.b24ClientId && env.b24ClientSecret) && Boolean(loadAppAuth(useDb())),
      onecMock: env.onecMock,
      onec: Boolean(env.onecUrl),
      session: Boolean(env.sessionSecret),
      mcpAdmin: Boolean(env.mcpAdminToken),
      db,
    },
  }
})
