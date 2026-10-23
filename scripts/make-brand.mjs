// Renders brand images from public/logo.png: favicon, PWA icons and the og:image preview.
// Run: node scripts/make-brand.mjs (uses the preinstalled Chromium via Playwright).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const root = join(import.meta.dirname, '..')
const logo = `data:image/png;base64,${readFileSync(join(root, 'public/logo.png')).toString('base64')}`

// The mascot is the left part of the logo; the icon crops it into a white rounded square.
const icon = size => `<div style="width:${size}px;height:${size}px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden">
  <div style="width:${size * 0.66}px;height:${size * 0.9}px;background:url(${logo}) no-repeat;background-size:auto 100%;background-position:0 50%"></div></div>`

const og = `<div style="width:1200px;height:630px;background:linear-gradient(135deg,#f4f7fb,#e3ecf8);display:flex;flex-direction:column;justify-content:center;padding:0 96px;box-sizing:border-box;font-family:Arial,sans-serif">
  <img src="${logo}" style="height:150px;width:auto;align-self:flex-start">
  <div style="margin-top:48px;font-size:64px;font-weight:700;color:#1f2633">Личный кабинет оптового покупателя</div>
  <div style="margin-top:20px;font-size:36px;color:#4a5566">Каталог с вашими ценами и остатками, заявка и дата доставки</div></div>`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' }).catch(() => chromium.launch())
async function shot(html, w, h, out) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.setContent(`<body style="margin:0">${html}</body>`)
  await page.screenshot({ path: join(root, 'public', out) })
  await page.close()
}
await shot(icon(64), 64, 64, 'favicon.png')
await shot(icon(192), 192, 192, 'icon-192.png')
await shot(icon(512), 512, 512, 'icon-512.png')
await shot(og, 1200, 630, 'og.png')
await browser.close()
