// Живость процесса и коммит сборки — для make doctor, Watchtower и проверки после выката
// (docs/DEPLOY.md). Без секретов: только какие настройки заданы.
export default defineEventHandler(() => {
  const env = readServerEnv()
  return {
    status: 'ok',
    commit: env.commitSha ? env.commitSha.slice(0, 7) : null,
    config: {
      b24Webhook: Boolean(env.b24WebhookUrl),
      onecMock: env.onecMock,
      onec: Boolean(env.onecUrl),
      deepseek: Boolean(env.deepseekApiKey),
      session: Boolean(env.sessionSecret),
      mcpAdmin: Boolean(env.mcpAdminToken),
    },
  }
})
