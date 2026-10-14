import { normalizeHost } from './managerTab'

/** CSP для ответа: /b24/* — только портал коробки, остальное — ни в какой фрейм. */
export function frameAncestorsPolicy(path: string, portalHosts: string): string {
  if (!path.startsWith('/b24/')) return "frame-ancestors 'none'"
  const hosts = portalHosts.split(',').map(h => normalizeHost(h)).filter((h): h is string => !!h)
  return hosts.length ? `frame-ancestors ${hosts.map(h => `https://${h}`).join(' ')}` : "frame-ancestors 'none'"
}
