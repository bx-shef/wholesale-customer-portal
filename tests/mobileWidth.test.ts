// Ширина на телефоне (#77): длинное название товара в шапке раздувало страницу до 494 px.
// Замер: без ограничения — 459 px при экране 390, с ним — 390 (Chromium, 2026-10-22).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('ширина страниц на телефоне', () => {
  it('заголовок шапки ограничен шириной экрана и обрезается', () => {
    const header = read('app/components/AppHeader.vue')
    expect(header).toMatch(/max-w-\[calc\(100vw-[^\]]+\)\]/)
    expect(header).toContain('<span class="min-w-0 truncate">')
  })

  it('карточка товара: длинные слова переносятся, название аналога сжимается', () => {
    const page = read('app/pages/product/[guid].vue')
    expect(page).toContain('leading-snug break-words')
    expect(page).toContain('<div class="min-w-0">')
    expect(page).toContain('<dd class="break-words">{{ v }}</dd>')
  })

  it('корзина и заявки: длинное название не распирает строку с кнопкой', () => {
    expect(read('app/pages/cart.vue')).toContain('leading-snug min-w-0 break-words')
    expect(read('app/pages/orders.vue')).toContain('font-semibold min-w-0 break-words')
  })

  it('минимальный заказ виден всегда', () => {
    expect(read('app/pages/product/[guid].vue')).toContain('минимальный заказ {{ formatQty(Math.max(item.minQty, item.packQty), item.unit) }}')
  })
})
