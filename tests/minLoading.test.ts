// Экран загрузки (#78): держится не меньше 3 секунд, сцены стройки и дачи, без расхождения с сервером.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMinHold, holdRemaining, MIN_LOADING_MS } from '../shared/minLoading'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('holdRemaining', () => {
  it('минимум 3 секунды от начала загрузки', () => {
    expect(MIN_LOADING_MS).toBe(3000)
    expect(holdRemaining(1000, 1500)).toBe(2500)
    expect(holdRemaining(1000, 4000)).toBe(0)
    expect(holdRemaining(1000, 9000)).toBe(0)
    expect(holdRemaining(null, 1500)).toBe(0)
  })
})

describe('createMinHold', () => {
  function setup() {
    let t = 0
    const timers: Array<{ at: number, fn: () => void }> = []
    const log: boolean[] = []
    const hold = createMinHold({
      onChange: v => log.push(v),
      now: () => t,
      schedule: (fn, ms) => { const h = { at: t + ms, fn }; timers.push(h); return h },
      cancel: h => { const i = timers.indexOf(h as never); if (i >= 0) timers.splice(i, 1) },
    })
    const tick = (ms: number) => {
      t += ms
      for (const h of [...timers]) if (h.at <= t) { timers.splice(timers.indexOf(h), 1); h.fn() }
    }
    return { hold, log, tick, timers }
  }

  it('быстрый ответ — экран держится до 3 секунд от начала', () => {
    const s = setup()
    s.hold.set(true)
    s.tick(200)
    s.hold.set(false)
    expect(s.log).toEqual([true])
    s.tick(2799)
    expect(s.log).toEqual([true])
    s.tick(1)
    expect(s.log).toEqual([true, false])
  })

  it('медленный ответ — экран убирается сразу', () => {
    const s = setup()
    s.hold.set(true)
    s.tick(5000)
    s.hold.set(false)
    expect(s.log).toEqual([true, false])
  })

  it('загрузка снова пошла во время удержания — таймер снят; следующая загрузка держится заново', () => {
    const s = setup()
    s.hold.set(true)
    s.hold.set(false)
    s.hold.set(true)
    expect(s.timers).toHaveLength(0)
    s.tick(4000)
    s.hold.set(false)
    expect(s.log.at(-1)).toBe(false)
    s.hold.set(true)
    s.tick(100)
    s.hold.set(false)
    s.tick(100)
    expect(s.log.at(-1)).toBe(true)
    s.tick(2800)
    expect(s.log.at(-1)).toBe(false)
  })

  it('повторный сигнал «загрузка идёт» не продлевает удержание: отсчёт от первого начала', () => {
    const s = setup()
    s.hold.set(true)
    s.tick(2000)
    s.hold.set(true)
    s.tick(500)
    s.hold.set(false)
    s.tick(500)
    expect(s.log.at(-1)).toBe(false)
  })

  it('stop снимает таймер — после ухода со страницы ничего не срабатывает', () => {
    const s = setup()
    s.hold.set(true)
    s.hold.set(false)
    s.hold.stop()
    s.tick(5000)
    expect(s.log).toEqual([true])
  })
})

describe('экран загрузки', () => {
  it('загрузка данных клиента и карточка товара держатся не меньше 3 секунд', () => {
    expect(read('app/components/ClientDataGate.vue')).toContain('useMinLoading(() => pending.value || !data.value)')
    expect(read('app/components/ClientDataGate.vue')).toContain('!failed && holding"')
    expect(read('app/pages/product/[guid].vue')).toContain('<BuildLoader v-else-if="holding')
  })

  it('сцены: стройка (экскаватор, кран, дом) и дача (дом, дерево, бассейн); на сервере — всегда стройка', () => {
    const src = read('app/components/BuildLoader.vue')
    expect(src).toContain('build: [BuildExcavator, BuildCrane, BuildHouse]')
    expect(src).toContain('dacha: [BuildHouse, BuildTree, BuildPool]')
    expect(src).toContain("const scene = ref<keyof typeof SCENES>('build')")
    for (const f of ['Excavator', 'Crane', 'House', 'Tree', 'Pool']) expect(read(`app/components/build/${f}.vue`), f).toContain('prefers-reduced-motion')
  })
})
