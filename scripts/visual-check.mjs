/**
 * Visual smoke test — drives the running Node server (site + admin) through the
 * system Edge via playwright-core.
 *
 *   npm run start            # or: node server/index.js
 *   npm run check:visual
 *
 * Env: BASE=http://127.0.0.1:8787  EDGE_PATH="C:\\...\\msedge.exe"
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import '../server/env.js' // pick up ADMIN_TOKEN from .env when present

const BASE = process.env.BASE || 'http://127.0.0.1:8787'
const EDGE_PATH =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const OUT = process.env.OUT || 'shots'

mkdirSync(OUT, { recursive: true })

// Chromium normally follows the system proxy; PROXY_SERVER forces one (needed on
// networks where *.vercel.app resolves to bogus addresses).
const PROXY_SERVER = process.env.PROXY_SERVER || ''

const browser = await chromium.launch({
  executablePath: EDGE_PATH,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    ...(PROXY_SERVER ? [`--proxy-server=${PROXY_SERVER}`] : []),
  ],
})

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ignoreHTTPSErrors: true,
  locale: 'zh-CN',
})

const page = await context.newPage()
const problems = []

page.on('console', (msg) => {
  // The embedded Bilibili player logs its own telemetry errors from inside the
  // iframe; those are third-party and not actionable here.
  if (msg.type() !== 'error') return
  if (/bili-user-fingerprint|report is not found|net::|Failed to load resource/i.test(msg.text())) return
  problems.push(`[console] ${msg.text()}`)
})
page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`))

async function shot(name, { full = false, wait = 1300, viewport } = {}) {
  if (viewport) await page.setViewportSize(viewport)
  await page.waitForTimeout(wait)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full })
  console.log(`  ✔ ${name}`)
}

async function go(path, wait = 1400) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(wait)
  // A cold serverless function (or a slow link) needs longer than a local
  // server, so wait for skeletons to clear instead of trusting a fixed delay.
  await page
    .waitForFunction(() => !document.querySelector('.v-skeleton-loader'), { timeout: 20000 })
    .catch(() => {})
}

// library must exist (added via the admin page / API)
const library = await (await fetch(`${BASE}/api/videos`)).json()
if (!library.total) {
  console.error('视频库为空：请先在 /admin 里用 bvid 投稿，再运行该脚本。')
  await browser.close()
  process.exit(1)
}
const first = library.items[0]
console.log(`library: ${library.total} 个视频，首个 = ${first.bvid} ${first.title}`)

/* ---------------- site ---------------- */
console.log('→ home')
await go('/')
const cardCount = await page.locator('.video-card').count()
const coverOk = await page.evaluate(() => {
  const img = document.querySelector('.video-card__cover img')
  return img ? img.naturalWidth > 0 : false
})
console.log(`  ℹ cards=${cardCount} firstCoverLoaded=${coverOk}`)
await shot('01-home')

console.log('→ search')
await go('/search?keywords=游戏')
await shot('02-search', { wait: 1800 })

console.log('→ video page')
await go(`/video/${first.bvid}`, 3000)
const info = await page.evaluate(() => ({
  title: document.querySelector('.video-header__title')?.textContent?.trim() ?? '',
  up: document.querySelector('.video-header__up-name')?.textContent?.trim() ?? '',
  desc: document.querySelector('.video-summary__text')?.textContent?.trim().slice(0, 40) ?? '',
  stats: [...document.querySelectorAll('.video-stat')].map((el) => el.textContent.trim()),
  iframe: Boolean(document.querySelector('.bp__iframe')),
  playerLoaded: !document.querySelector('.bp__cover'),
  tags: document.querySelectorAll('.video-header__tags .v-chip').length,
}))
console.log(`  ℹ ${JSON.stringify(info)}`)
await shot('03-video', { wait: 500 })

console.log('→ favourite + comments')
await page.locator('.video-actions button:has-text("加入我的收藏")').first().click()
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/04-bilibili-comments.png` })
// local comments live in the second tab
await page.locator('.comments-section__head .v-tab', { hasText: '本站评论' }).click()
await page.waitForTimeout(700)
await page.locator('.composer__input textarea:not([readonly])').first().fill('来自自动化检查的评论')
await page.locator('.composer__actions button:has-text("发布")').click()
await page.waitForTimeout(900)
await page.evaluate(() => window.scrollTo({ top: 980, behavior: 'instant' }))
await shot('04b-video-local-comments', { wait: 500 })

console.log('→ favourites page')
await go('/favorites')
await shot('05-favorites')

console.log('→ blank / error states')
await go('/video/BV0000000000')
await shot('06-video-missing')
await go('/nope')
await shot('07-notfound')

console.log('→ admin')
await go('/admin', 1600)
// when the server requires ADMIN_TOKEN, unlock the page before the screenshot
const adminHealth = await (await fetch(`${BASE}/api/health`)).json()
if (adminHealth.authRequired && process.env.ADMIN_TOKEN) {
  await page.locator('#token-input').fill(process.env.ADMIN_TOKEN)
  await page.locator('#token-save').click()
  await page.waitForTimeout(600)
}
await shot('08-admin')

console.log('→ dark theme')
await go('/')
await page.getByRole('button', { name: /切换到深色主题|切换到浅色主题/ }).click()
await page.waitForTimeout(800)
await shot('09-home-dark')
await go(`/video/${first.bvid}`, 2200)
await shot('10-video-dark', { wait: 500 })

console.log('→ mobile')
await page.setViewportSize({ width: 414, height: 900 })
await go('/')
await shot('11-mobile-home')
await go(`/video/${first.bvid}`, 2200)
await shot('12-mobile-video')
await go('/admin', 1500)
await shot('13-mobile-admin')

await browser.close()

if (problems.length) {
  console.log('\n⚠ problems:')
  problems.forEach((p) => console.log('  ' + p))
  writeFileSync(`${OUT}/problems.txt`, problems.join('\n'), 'utf8')
} else {
  console.log('\n✔ no console/page errors')
}
