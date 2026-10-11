import { setTimeout as delay } from 'node:timers/promises'
import { handleMockRequest, type MockState } from './mock'

/** `fetch`, который отвечает моком, не выходя в сеть. */
export function mockFetch(state: MockState, now: () => number = Date.now): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const headers = new Headers(init?.headers)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined
    const res = handleMockRequest(state, {
      method: init?.method ?? 'GET',
      path: url.pathname.replace(/^\/mock-1c/, ''),
      query: Object.fromEntries(url.searchParams),
      body,
      authorization: headers.get('authorization'),
    }, now())
    // Задержка прерывается таймаутом клиента, как настоящий fetch, — а не досиживается до конца.
    if (res.delayMs > 0) await delay(res.delayMs, undefined, { signal: init?.signal ?? undefined })
    init?.signal?.throwIfAborted()
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'content-type': 'application/json' } })
  }
}
