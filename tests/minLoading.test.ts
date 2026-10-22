// Экран загрузки (#78): держится не меньше 3 секунд, сцены стройки и дачи, без расхождения с сервером.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { holdRemaining, MIN_LOADING_MS } from '../shared/minLoading'

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
