import { describe, expect, it, vi } from 'vitest'
import { generateSeed } from '../server/mocks/onec/seed'
import { emptyDeliveryState, episodeKey, markAnnounced, markRecovered, MIN_REANNOUNCE_MS, planAlertDelivery, recoveryMessage, alertMessage, type Alert } from '../server/utils/alertDelivery'
import { errorClass, FAILURES_TO_ALERT, flowHealth, healthAlerts, type FlowRunRow } from '../server/utils/syncHealth'
import { MAX_TELEGRAM_TEXT, resolveTelegramConfig, sendTelegramAlert, type TelegramSendResult } from '../server/utils/telegramAlert'
import { parseDeliveryState, runAlertTick } from '../server/utils/alertTick'
import { MANUAL_MIN_INTERVAL_MS, manualRunVerdict } from '../server/utils/manualRun'
import { STAND_WRITE_HEADER, standWriteAllowed } from '../server/utils/onecTestAuth'
import { SYSTEM_PAGE } from '../server/utils/systemPage'
import { ONEC_TEST_PAGE } from '../server/utils/onecTestPage'
import { readSystemStatus } from '../server/utils/systemStatus'
import { openDatabase } from '../server/db/sqlite'
import { createMockState, handleMockRequest, type MockRequest } from '../server/mocks/onec/mock'

const T0 = Date.parse('2026-10-15T10:00:00Z')
const run = (status: string, minutesAgo: number, error: string | null = null): FlowRunRow => {
  const at = new Date(T0 - minutesAgo * 60_000).toISOString()
  return { flow: 'stock', status, startedAt: at, finishedAt: at, received: 0, error }
}

describe('здоровье обмена', () => {
  it('один сбой — ещё не тревога, два подряд — тревога с классом ошибки, но без её текста', () => {
    // Один сбой — не тревога в Telegram, но и не «в порядке»: страница его показывает.
    const one = flowHealth('stock', [run('failed', 1), run('done', 6)], T0, 1e9)
    expect(one.state).toBe('warning')
    expect(healthAlerts([one], { pausedUntil: 0 }, T0)).toEqual([])
    const h = flowHealth('stock', [run('failed', 1, 'OnecError: ООО «Ромашка», УНП 190000000 — не по схеме'), run('failed', 6), run('done', 11)], T0, 1e9)
    expect(h.failuresInRow).toBe(FAILURES_TO_ALERT)
    expect(h.state).toBe('failing')
    const text = healthAlerts([h], { pausedUntil: 0 }, T0)[0]!.text
    expect(text).toContain('OnecError')
    expect(text).not.toContain('Ромашка')
    expect(errorClass('не по форме')).toBe('ошибка')
  })

  it('последний запуск на странице — завершённый, а не идущий', () => {
    const h = flowHealth('stock', [run('running', 0), run('failed', 5, 'X: y')], T0, 1e9)
    expect(h.lastRun?.status).toBe('failed')
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
    const ok = await sendTelegramAlert(cfg, 'x', async () => ({ status: 200 }))
    expect(ok.ok).toBe(true)
  })

  it('429 и 5xx — повторяем, 400 — нет; текст обрезан, превью ссылок выключено', async () => {
    const cfg = { token: '123456:SECRET', chatId: '-100' }
    const at = (status: number) => sendTelegramAlert(cfg, 'x', async () => ({ status }))
    expect((await at(429)).retryable).toBe(true)
    expect((await at(502)).retryable).toBe(true)
    expect(await at(400)).toEqual({ ok: false, status: 400, retryable: false })
    let body = ''
    await sendTelegramAlert(cfg, 'я'.repeat(5000), async (_u, init) => { body = init.body; return { status: 200 } })
    const sent = JSON.parse(body)
    expect(sent.text).toHaveLength(MAX_TELEGRAM_TEXT)
    expect(sent).toMatchObject({ chat_id: '-100', disable_web_page_preview: true })
    expect(sent.parse_mode).toBeUndefined()
  })
})

describe('управление моком для проверки синхронизации', () => {
  const req = (r: Partial<MockRequest>): MockRequest => ({ method: 'GET', path: '/', query: {}, authorization: 'Bearer t', ...r })

  it('_admin/price, _admin/item и _admin/debt видны по changedSince', () => {
    // Позже всех changedAt сида (сгенерированные товары — 2026-10-22).
    const T1 = Math.max(...generateSeed(1).items.map(i => Date.parse(i.changedAt))) + 60_000
    const state = createMockState('t')
    const since = (path: string, t: number) => handleMockRequest(state, req({ path, query: { changedSince: new Date(t).toISOString(), pageSize: '500' } }), t + 1000).body as { items: unknown[] }
    expect(since('/prices', T1 + 1).items).toEqual([])
    handleMockRequest(state, req({ method: 'POST', path: '/_admin/price', body: { count: 2 } }), T1 + 10)
    // Цена товара — по каждому виду цен: 2 товара × 3 вида.
    expect(new Set((since('/prices', T1 + 1).items as { itemGuid: string }[]).map(p => p.itemGuid)).size).toBe(2)
    handleMockRequest(state, req({ method: 'POST', path: '/_admin/price', body: { count: 999 } }), T1 + 20)
    expect(new Set((since('/prices', T1 + 11).items as { itemGuid: string }[]).map(p => p.itemGuid)).size).toBe(50)
    handleMockRequest(state, req({ method: 'POST', path: '/_admin/item', body: { index: 1, name: 'Новое имя' } }), T1 + 10)
    expect((since('/catalog', T1 + 1).items as { name: string }[]).map(i => i.name)).toEqual(['Новое имя'])
    handleMockRequest(state, req({ method: 'POST', path: '/_admin/debt', body: { add: 100 } }), T1 + 10)
    expect(since('/clients', T1 + 1).items).toHaveLength(1)
  })

  it('reset сохраняет демо-клиентов из ONEC_MOCK_CLIENTS', () => {
    const guid = '0aaaaaa0-aa0a-00a0-a00a-00000a000a00'
    const state = createMockState('t', 1, [guid])
    handleMockRequest(state, req({ method: 'POST', path: '/_admin/reset' }), T0)
    expect(state.data.clients.map(c => c.guid)).toContain(guid)
  })
})

describe('тик оповещений', () => {
  const a: Alert = { kind: 'onec-paused', subject: '1С', text: 'встала' }
  const sender = (results: TelegramSendResult[]) => {
    const texts: string[] = []
    return { texts, send: async (t: string) => { texts.push(t); return results.shift() ?? { ok: true, status: 200, retryable: false } } }
  }

  it('временный сбой — повтор на следующем тике, удача — тишина, восстановление — ✅', async () => {
    const s1 = sender([{ ok: false, status: 429, retryable: true }])
    let r = await runAlertTick([a], emptyDeliveryState(), { send: s1.send, now: T0, statusUrl: null })
    expect([r.sent, r.failed]).toEqual([0, 1])
    const s2 = sender([])
    r = await runAlertTick([a], r.state, { send: s2.send, now: T0 + 300_000, statusUrl: 'https://wsp/api/system' })
    expect(s2.texts[0]).toContain('https://wsp/api/system')
    const s3 = sender([])
    r = await runAlertTick([a], r.state, { send: s3.send, now: T0 + 600_000, statusUrl: null })
    expect(s3.texts).toEqual([])
    const s4 = sender([])
    r = await runAlertTick([], r.state, { send: s4.send, now: T0 + 900_000, statusUrl: null })
    expect(s4.texts[0]).toContain('✅')
    expect(r.state.awaitingRecovery).toEqual([])
  })

  it('постоянный отказ (400) не долбит Telegram каждые 5 минут', async () => {
    const s1 = sender([{ ok: false, status: 400, retryable: false }])
    const r = await runAlertTick([a], emptyDeliveryState(), { send: s1.send, now: T0, statusUrl: null })
    const s2 = sender([])
    await runAlertTick([a], r.state, { send: s2.send, now: T0 + 300_000, statusUrl: null })
    expect(s2.texts).toEqual([])
  })

  it('состояние переживает выкат через JSON, битое — пустое', () => {
    const st = markAnnounced(emptyDeliveryState(), 'k', T0)
    expect(parseDeliveryState(JSON.stringify(st))).toEqual(st)
    expect(parseDeliveryState('{oops')).toEqual(emptyDeliveryState())
    expect(parseDeliveryState(JSON.stringify({ announcedAtMs: { k: 'x' }, awaitingRecovery: [1, 'k'] }))).toEqual({ announcedAtMs: {}, awaitingRecovery: ['k'] })
  })
})

describe('ручной запуск и защита стенда', () => {
  it('идущий поток — busy, чаще интервала — too-soon', () => {
    expect(manualRunVerdict('catalog', new Set(['catalog']), undefined, T0)).toMatchObject({ ok: false, reason: 'busy' })
    expect(manualRunVerdict('catalog', new Set(), T0 - 60_000, T0)).toMatchObject({ ok: false, reason: 'too-soon', retryInMs: MANUAL_MIN_INTERVAL_MS.catalog! - 60_000 })
    expect(manualRunVerdict('catalog', new Set(), T0 - MANUAL_MIN_INTERVAL_MS.catalog!, T0)).toEqual({ ok: true })
    expect(manualRunVerdict('stock', new Set(['catalog']), undefined, T0)).toEqual({ ok: true })
  })

  it('POST стенда — только со своей страницы (заголовок), GET — всегда', () => {
    expect(standWriteAllowed('GET', null)).toBe(true)
    expect(standWriteAllowed('POST', null)).toBe(false)
    expect(standWriteAllowed('POST', '0')).toBe(false)
    expect(standWriteAllowed('POST', '1')).toBe(true)
  })

  it('страницы стенда шлют заголовок в каждом POST', () => {
    expect(SYSTEM_PAGE).toContain(`'${STAND_WRITE_HEADER}': '1'`)
    expect(ONEC_TEST_PAGE).toContain(`'${STAND_WRITE_HEADER}': '1'`)
  })
})

describe('состояние системы из базы', () => {
  it('потоки, счётчики, заявки и пауза 1С', () => {
    const db = openDatabase(':memory:')
    const at = (m: number) => new Date(T0 - m * 60_000).toISOString()
    const ins = db.prepare('INSERT INTO sync_run (flow, status, started_at, finished_at, received, error) VALUES (?, ?, ?, ?, ?, ?)')
    ins.run('stock', 'done', at(10), at(10), 5, null)
    ins.run('stock', 'failed', at(5), at(5), 0, 'OnecError: x')
    ins.run('stock', 'failed', at(1), at(1), 0, 'OnecError: y')
    ins.run('prices', 'done', at(2), at(2), 7, null)
    const s = readSystemStatus(db, { guard: { failures: 1, pausedUntil: T0 + 60_000 }, mode: 'mock', commit: 'abc', telegram: false, now: T0 })
    expect(s.flows.find(f => f.flow === 'stock')!.state).toBe('failing')
    expect(s.flows.find(f => f.flow === 'prices')!.state).toBe('ok')
    expect(s.counts['товары']).toBe(0)
    expect(s.recentRuns).toHaveLength(4)
    expect(s.onec.pausedUntil).not.toBeNull()
    expect(s.alerts.map(x => x.kind).sort()).toEqual(['onec-paused', 'sync-failed'])
    expect(readSystemStatus(db, { guard: { failures: 0, pausedUntil: T0 - 1 }, mode: 'mock', commit: 'abc', telegram: false, now: T0 }).onec.pausedUntil).toBeNull()
  })
})
