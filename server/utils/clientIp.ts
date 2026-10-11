/**
 * Адрес клиента для лимита входа. За nginx-proxy (TRUST_PROXY=1) берём ПРАВЫЙ адрес
 * X-Forwarded-For — его дописывает сам прокси. Левые части пишет клиент: h3 `getRequestIP`
 * берёт первый и позволял подставлять новый адрес на каждую попытку (ревью PR #4).
 * Схема рассчитана на один доверенный прокси перед приложением (docs/DEPLOY.md).
 */
export function clientIp(forwardedFor: string | undefined, socketAddress: string | undefined, trustProxy: boolean): string {
  if (trustProxy && forwardedFor) {
    const last = forwardedFor.split(',').map(s => s.trim()).filter(Boolean).at(-1)
    if (last) return last
  }
  return socketAddress || 'unknown'
}
