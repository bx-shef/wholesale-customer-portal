import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// #72: справку было не открыть — пункт «Справка» обязан быть в боковом меню (на телефоне оно выезжает).
describe('выход с экрана ошибки данных клиента (стенд 2026-10-26)', () => {
  it('на экране ошибки есть «Выйти» общим выходом', () => {
    const gate = readFileSync('app/components/ClientDataGate.vue', 'utf8')
    expect(gate).toContain('useLogout()')
    expect(gate).toMatch(/<B24Button color="air-tertiary" label="Выйти" @click="logout" \/>/)
  })
})

describe('ссылка на справку в меню', () => {
  const src = readFileSync('app/layouts/default.vue', 'utf8')
  it('пункт «Справка» в разделах меню', () => {
    expect(src).toMatch(/\{ label: 'Справка', icon: QuestionIcon, to: '\/help'/)
  })
  it('логотип и название в меню — не ссылка', () => {
    const header = src.slice(src.indexOf('<template #header'), src.indexOf('</template>', src.indexOf('<template #header')))
    expect(header).not.toMatch(/<(NuxtLink|B24Link|a)\b/)
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
    expect(readFileSync('app/pages/help.vue', 'utf8')).toMatch(/<AppPage v-if="me"/)
  })
})

describe('выход стирает фильтры (справка это обещает)', () => {
  it('logout удаляет wcp-catalog-filters', () => {
    expect(readFileSync('app/composables/useLogout.ts', 'utf8')).toContain("localStorage.removeItem('wcp-catalog-filters')")
    expect(readFileSync('app/pages/index.vue', 'utf8')).toContain("'wcp-catalog-filters'")
  })
})

describe('фавикон и превью ссылки', () => {
  it('фавикон и og:image — файлы в public, og:image абсолютным адресом', () => {
    const config = readFileSync('nuxt.config.ts', 'utf8')
    expect(config).toContain("href: '/favicon.png'")
    const app = readFileSync('app/app.vue', 'utf8')
    expect(app).toMatch(/ogImage: \(\) => `\$\{origin\.value\}\/og\.png`/)
    for (const f of ['public/favicon.png', 'public/og.png', 'public/icon-192.png']) expect(readFileSync(f).subarray(1, 4).toString()).toBe('PNG')
  })
})

describe('раскладка: выход, гидрация, чат (панель PR #92)', () => {
  const src = readFileSync('app/layouts/default.vue', 'utf8')
  const logout = readFileSync('app/composables/useLogout.ts', 'utf8')
  it('выход сбрасывает «кто вошёл» до перехода на /login, на /login меню нет', () => {
    expect(logout.indexOf("clearNuxtData('me')")).toBeGreaterThan(-1)
    expect(logout.indexOf("clearNuxtData('me')")).toBeLessThan(logout.indexOf("navigateTo('/login')"))
    expect(src).toContain('useLogout()')
    expect(src).toContain("route.path !== '/login'")
  })
  it('свёрнутость меню не из localStorage (иначе расхождение гидрации)', () => {
    expect(src).not.toMatch(/storage="local"/)
  })
  it('ИИ-помощника в раскладке нет (убран, #75)', () => {
    expect(src).not.toContain('useAiChat')
  })
})

describe('компания внизу меню (владелец 2026-10-27)', () => {
  const src = readFileSync('app/layouts/default.vue', 'utf8')
  it('название не обрезается и стоит по центру', () => {
    expect(src).not.toContain('line-clamp')
    expect(src).toContain("labelInner: 'whitespace-normal break-words text-center'")
  })
  it('аватар не синий', () => {
    expect(src).not.toMatch(/avatar="\{[^}]*accent-main-primary/)
  })
})

describe('подвал корзины не под плавающей панелью (владелец 2026-10-27)', () => {
  it('корзина с товарами поднимает подвал над панелью на телефоне', () => {
    expect(readFileSync('app/pages/cart.vue', 'utf8')).toContain(':bottom-bar="cart.lines.value.length > 0"')
    expect(readFileSync('app/components/AppPage.vue', 'utf8')).toContain("<AppFooter :class=\"bottomBar ? 'pb-28 md:pb-6' : ''\" />")
  })
})

describe('выпадающие списки корзины не вылезают за край (владелец 2026-10-27)', () => {
  it('соглашение и адрес — с переносом', () => {
    const src = readFileSync('app/pages/cart.vue', 'utf8')
    expect(src.match(/:b24ui="WRAP_SELECT"/g)).toHaveLength(2)
    expect(src).toContain("value: 'whitespace-normal break-words text-start'")
  })
})
