// Название сделки (#77): компания из карточки CRM, а не имя клиента из 1С (на моке — «Демо-клиент»).
import { describe, expect, it } from 'vitest'
import { dealClientName } from '../server/utils/orders'

describe('подпись сделки', () => {
  it('название компании из CRM; пусто или сбой CRM — имя клиента из 1С', async () => {
    expect(await dealClientName(7, 'Демо-клиент 2', async () => 'Рога И Копыта')).toBe('Рога И Копыта')
    expect(await dealClientName(7, 'Демо-клиент 2', async () => '  ')).toBe('Демо-клиент 2')
    expect(await dealClientName(7, 'Демо-клиент 2', async () => null)).toBe('Демо-клиент 2')
    expect(await dealClientName(7, 'Демо-клиент 2', async () => { throw new Error('crm down') })).toBe('Демо-клиент 2')
    expect(await dealClientName(7, 'Демо-клиент 2')).toBe('Демо-клиент 2')
  })
})

describe('профиль (#77)', () => {
  it('блок компании и подсказка без телефона менеджера', async () => {
    const { readFileSync } = await import('node:fs')
    const page = readFileSync(new URL('../app/pages/profile.vue', import.meta.url), 'utf8')
    expect(page).toContain('{{ data.company.title }}')
    expect(page).toContain('Телефон менеджера не указан — закажите звонок')
  })
})

describe('корзина (#77)', () => {
  it('«Корзина пуста» — только после чтения корзины с устройства', async () => {
    const { readFileSync } = await import('node:fs')
    const page = readFileSync(new URL('../app/pages/cart.vue', import.meta.url), 'utf8')
    expect(page).toMatch(/v-if="!cart\.loaded\.value"[\s\S]*v-else-if="cart\.lines\.value\.length === 0"/)
  })
})
