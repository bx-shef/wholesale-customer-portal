import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// #72: справку было не открыть — пункт «Справка» обязан быть и в кнопках, и в меню-бургере.
describe('ссылка на справку в шапке', () => {
  const src = readFileSync('app/components/AppHeader.vue', 'utf8')
  it('есть в меню-бургере', () => {
    expect(src).toMatch(/\{ to: '\/help', label: 'Справка' \}/)
  })
  it('есть кнопкой на компьютере', () => {
    expect(src).toMatch(/<B24Button to="\/help"[^>]*label="Справка"/)
  })
  it('справка описывает вход, корзину и статусы', () => {
    const md = readFileSync('content/help/index.md', 'utf8')
    for (const h of ['## Как войти', '## Корзина и заявка', '## Мои заявки']) expect(md).toContain(h)
  })
})

describe('справка доступна до входа', () => {
  it('на странице входа есть ссылка на справку', () => {
    expect(readFileSync('app/pages/login.vue', 'utf8')).toMatch(/<NuxtLink to="\/help"/)
  })
  it('без сессии справка не показывает разделы кабинета', () => {
    expect(readFileSync('app/pages/help.vue', 'utf8')).toMatch(/<AppHeader v-if="me"/)
  })
})
