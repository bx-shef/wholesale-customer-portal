import { describe, expect, it, vi } from 'vitest'
import { emptyDeliveryState, episodeKey, markAnnounced, markRecovered, MIN_REANNOUNCE_MS, planAlertDelivery, recoveryMessage, alertMessage, type Alert } from '../server/utils/alertDelivery'
import { FAILURES_TO_ALERT, flowHealth, healthAlerts, type FlowRunRow } from '../server/utils/syncHealth'
import { resolveTelegramConfig, sendTelegramAlert } from '../server/utils/telegramAlert'
import { createMockState, handleMockRequest, type MockRequest } from '../server/mocks/onec/mock'

const T0 = Date.parse('2026-10-15T10:00:00Z')
const run = (status: string, minutesAgo: number, error: string | null = null): FlowRunRow => {
  const at = new Date(T0 - minutesAgo * 60_000).toISOString()
  return { flow: 'stock', status, startedAt: at, finishedAt: at, received: 0, error }
}

describe('здоровье обмена', () => {
  it('один сбой — ещё не тревога, два подряд — тревога с текстом ошибки', () => {
    expect(flowHealth('stock', [run('failed', 1), run('done', 6)], T0, 1e9).state).toBe('ok')
    const h = flowHealth('stock', [run('failed', 1, 'HTTP 503'), run('failed', 6), run('done', 11)], T0, 1e9)
    expect(h.failuresInRow).toBe(FAILURES_TO_ALERT)
    expect(h.state).toBe('failing')
    expect(healthAlerts([h], { pausedUntil: 0 }, T0)[0]!.text).toContain('HTTP 503')
  })

  it('удачный запуск старше срока — stale; идущий запуск сбои не прерывает', () => {
    expect(flowHealth('stock', [run('done', 31)], T0, 1e9).state).toBe('stale')
    expect(flowHealth('stock', [run('running', 0), run('done', 5)], T0, 1e9).state).toBe('ok')
  })

  it('ни одного запуска: сразу после старта молчим, потом тревога', () => {
    expect(flowHealth('stock', [], T0, 60_000).state).toBe('never')
    expect(flowHealth('stock', [], T0, 31 * 60_000).state).toBe('stale')
  })

  it('пауза 1С — отдельная тревога', () => {
    expect(healthAlerts([], { pausedUntil: T0 + 1 }, T0).map(a => a.kind)).toEqual(['onec-paused'])
    expect(healthAlerts([], { pausedUntil: T0 - 1 }, T0)).toEqual([])
  })
})

describe('доставка оповещений', () => {
  const a: Alert = { kind: 'sync-failed', subject: 'остатки', text: 'падает' }
  it('одно сообщение на эпизод, ✅ после восстановления, повтор не раньше часа', () => {
    let p = planAlertDelivery([a], emptyDeliveryState(), T0)
    expect(p.opened).toEqual([a])
    let s = markAnnounced(p.state, episodeKey(a), T0)
    expect(planAlertDelivery([a], s, T0 + 60_000).opened).toEqual([])
    p = planAlertDelivery([], s, T0 + 120_000)
    expect(p.recovered).toEqual([episodeKey(a)])
    s = markRecovered(p.state, episodeKey(a))
    expect(planAlertDelivery([a], s, T0 + 180_000).opened).toEqual([])
    expect(planAlertDelivery([a], s, T0 + MIN_REANNOUNCE_MS + 1).opened).toEqual([a])
  })

  it('неотправленное не помечается: следующий тик пробует снова', () => {
    const p = planAlertDelivery([a], emptyDeliveryState(), T0)
    expect(planAlertDelivery([a], p.state, T0 + 1).opened).toEqual([a])
  })

  it('тексты: ссылка на состояние, восстановление по виду', () => {
    expect(alertMessage(a, 'https://x/api/system')).toContain('https://x/api/system')
    expect(recoveryMessage(episodeKey(a))).toContain('✅')
  })
})

describe('Telegram', () => {
  it('без обеих переменных или кривые — канал выключен', () => {
    expect(resolveTelegramConfig({})).toBeNull()
    expect(resolveTelegramConfig({ TELEGRAM_ALERT_BOT_TOKEN: 'bad', TELEGRAM_ALERT_CHAT_ID: '-100123' })).toBeNull()
    expect(resolveTelegramConfig({ TELEGRAM_ALERT_BOT_TOKEN: '123456:ABCdef_ghiJKLmnoPQRstuVWXyz012345', TELEGRAM_ALERT_CHAT_ID: '-100123' })).not.toBeNull()
  })

  it('сбой сети не выдаёт токен и помечается повторяемым', async () => {
    const cfg = { token: '123456:SECRET', chatId: '1' }
    const fetchFn = vi.fn(async () => { throw new Error('fetch https://api.telegram.org/bot123456:SECRET failed') })
    const r = await sendTelegramAlert(cfg, 'x', fetchFn)
    expect(r).toEqual({ ok: false, status: 0, retryable: true })
    expect(JSON.stringify(r)).not.toContain('SECRET')
    const ok = await sendTelegramAlert(cfg, 'x', async () => ({ status: 200 }) as Response)
    expect(ok.ok).toBe(true)
  })
})

describe('управление моком для проверки синхронизации', () => {
  const req = (r: Partial<MockRequest>): MockRequest => ({ method: 'GET', path: '/', query: {}, authorization: 'Bearer t', ...r })
  const since = (path: string, t: number) => handleMockRequest(createState.s, req({ path, query: { changedSince: new Date(t).toISOString() } }), t + 1000).body as { items: unknown[] }
  const createState = { s: createMockState('t') }

  it('_admin/price, _admin/item и _admin/debt видны по changedSince', () => {
    createState.s = createMockState('t')
    handleMockRequest(createState.s, req({ path: '/prices' }), T0)
    expect(since('/prices', T0 + 1).items).toEqual([])
    handleMockRequest(createState.s, req({ method: 'POST', path: '/_admin/price', body: { count: 2 } }), T0 + 10)
    expect(since('/prices', T0 + 1).items.length).toBeGreaterThanOrEqual(2)
    handleMockRequest(createState.s, req({ method: 'POST', path: '/_admin/item', body: { index: 1, name: 'Новое имя' } }), T0 + 10)
    expect((since('/catalog', T0 + 1).items as { name: string }[]).map(i => i.name)).toContain('Новое имя')
    handleMockRequest(createState.s, req({ method: 'POST', path: '/_admin/debt', body: { add: 100 } }), T0 + 10)
    expect(since('/clients', T0 + 1).items).toHaveLength(1)
  })
})
