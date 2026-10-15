import { describe, expect, it } from 'vitest'
import { createOnecGuard, OnecPausedError } from '../server/utils/onecGuard'
import { orderFactsDiff } from '../server/utils/orderSync'

describe('бережём 1С (§1.8)', () => {
  it('запросы идут по одному, не параллельно', async () => {
    let active = 0
    let maxActive = 0
    const slow: typeof fetch = async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(r => setTimeout(r, 5))
      active--
      return new Response('{}')
    }
    const f = createOnecGuard().wrap(slow)
    await Promise.all([f('https://1c/a'), f('https://1c/b'), f('https://1c/c')])
    expect(maxActive).toBe(1)
  })

  it('три сбоя подряд — пауза 10 минут, 4xx сбоем не считается, удача сбрасывает счёт', async () => {
    let t = 0
    const guard = createOnecGuard({ now: () => t })
    let status = 503
    const f = guard.wrap(async () => new Response('', { status }))
    await f('x')
    await f('x')
    status = 400
    await f('x')
    status = 503
    await f('x')
    await f('x')
    expect(guard.state().pausedUntil).toBe(0)
    await f('x')
    expect(guard.state().pausedUntil).toBe(600_000)
    await expect(f('x')).rejects.toBeInstanceOf(OnecPausedError)
    t = 600_001
    status = 200
    expect((await f('x')).status).toBe(200)
  })

  it('сетевая ошибка — тоже сбой, и очередь после неё не встаёт', async () => {
    const guard = createOnecGuard()
    const f = guard.wrap(async () => { throw new TypeError('fetch failed') })
    await expect(f('x')).rejects.toThrow('fetch failed')
    expect(guard.state().failures).toBe(1)
    await expect(f('x')).rejects.toThrow('fetch failed')
  })
})

describe('сверка при создании заказа (§2.6)', () => {
  const item = (guid: string, qty: number, price: number) => ({ guid, sku: `A-${guid}`, name: 'Товар', unit: 'шт', qty, price, vatRate: 20 })
  it('расхождений нет — null; цена и резерв — строками; нет строки — тоже расхождение', () => {
    expect(orderFactsDiff([item('a', 10, 18.2)], [{ itemGuid: 'A', price: 18.2, reserved: 10 }])).toBeNull()
    expect(orderFactsDiff([item('a', 10, 18.2), item('b', 2, 5), item('c', 1, 1)], [
      { itemGuid: 'a', price: 18.9, reserved: 8 },
      { itemGuid: 'b', price: 5, reserved: 2 },
    ])).toBe('Расхождения при создании заказа в 1С — согласуйте с клиентом:\nA-a: цена 18,20 → 18,90; резерв 8 из 10 шт\nA-c: 1С не вернула строку')
  })
})

describe('снятие паузы (кнопка «1С починили» на моке)', () => {
  it('reset снимает паузу и счёт сбоев', async () => {
    const guard = createOnecGuard({ now: () => 0 })
    const f = guard.wrap(async () => new Response('', { status: 503 }))
    for (let i = 0; i < 3; i++) await f('x')
    expect(guard.state().pausedUntil).toBeGreaterThan(0)
    guard.reset()
    expect(guard.state()).toMatchObject({ failures: 0, pausedUntil: 0 })
  })
})
