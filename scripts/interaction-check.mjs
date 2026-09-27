/**
 * Interaction smoke test (non-destructive).
 *
 * Covers the UI flows a screenshot cannot prove:
 *   • no 投稿 entry on the site (publishing lives in /admin)
 *   • the video page shows Bilibili metadata (title / UP 主 / 简介 / stats / embed)
 *   • the floating mini player keeps the SAME iframe alive across navigation
 *   • curated 分类 created in the admin show up as home-page sections
 *   • local favourites + local comments
 *
 * Anything it creates is removed again, and it never deletes an existing video.
 *
 *   npm run start
 *   npm run check:interaction
 */
import { chromium } from 'playwright-core'
import '../server/env.js' // pick up ADMIN_TOKEN from .env when present

const BASE = process.env.BASE || 'http://127.0.0.1:8787'
const TOKEN = process.env.ADMIN_TOKEN || ''
const EDGE =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ignoreHTTPSErrors: true,
  locale: 'zh-CN',
})
const page = await context.newPage()

// confirm()/prompt() in the admin page
page.on('dialog', (dialog) => {
  if (dialog.type() === 'prompt') dialog.accept('重命名后的分类')
  else dialog.accept()
})

const problems = []
let passed = 0
let failed = 0
const notes = []

const THIRD_PARTY_NOISE =
  /bili-user-fingerprint|report is not found|net::|Failed to load resource|bilivideo\.com|player\.bilibili\.com/i
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error' && !THIRD_PARTY_NOISE.test(m.text())) {
    problems.push(`[console] ${m.text()}`)
  }
})

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  ✔ ${name}`)
  } else {
    failed += 1
    console.log(`  ✘ ${name} ${detail}`)
  }
}

const api = {
  videos: async () => (await fetch(`${BASE}/api/videos`)).json(),
  collections: async () => (await fetch(`${BASE}/api/collections`)).json(),
}

/* ---------------- 1. server + library ---------------- */
console.log('→ server')
const health = await (await fetch(`${BASE}/api/health`)).json()
check('health responds', health.ok === true, JSON.stringify(health))
const library = await api.videos()
check('library has videos', library.total > 0, `total=${library.total}`)
// prefer a video that is NOT curated yet, so the user's 分类 assignment is
// never touched; remember the original value anyway and restore it exactly.
const sample =
  library.items.find((v) => v.desc && v.owner?.face && !v.collectionId) ||
  library.items.find((v) => !v.collectionId) ||
  library.items[0]
const originalCollectionId = sample.collectionId || ''
console.log(`  ℹ using ${sample.bvid} — ${sample.title} / ${sample.owner.name} (collectionId="${originalCollectionId}")`)

/* ---------------- 2. no 投稿 on the site ---------------- */
console.log('→ 投稿 removed from the site')
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
// only inspect the site chrome: real Bilibili titles/descriptions may well
// contain the word 投稿 themselves
const chromeText = await page.evaluate(() =>
  ['.v-app-bar', '.v-navigation-drawer', '.bottom-nav', '.footer']
    .map((sel) => document.querySelector(sel)?.innerText || '')
    .join(' '),
)
check('no 投稿 in the site chrome', !chromeText.includes('投稿'), chromeText.replace(/\s+/g, ' ').slice(0, 120))
check('no /upload link anywhere', (await page.locator('a[href="/upload"]').count()) === 0)
await page.goto(`${BASE}/upload`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
check('/upload falls through to 404', await page.locator('.notfound').isVisible())

/* ---------------- 3. video page = Bilibili data ---------------- */
console.log('→ video page shows Bilibili data')
await page.goto(`${BASE}/video/${sample.bvid}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2800)
check('title matches Bilibili', (await page.locator('.video-header__title').innerText()).trim() === sample.title.trim())
check('UP 主 name matches Bilibili', (await page.locator('.video-header__up-name').innerText()).trim() === sample.owner.name)
check(
  'UP 主 space link points at bilibili',
  (await page.locator('.video-header__up a').first().getAttribute('href')) ===
    `https://space.bilibili.com/${sample.owner.mid}`,
)
check('UP 主 avatar rendered', (await page.locator('.video-header__up-avatar img').count()) > 0)
const descText = await page.locator('.video-summary__text').innerText()
check(
  '简介 comes from Bilibili',
  sample.desc ? descText.includes(sample.desc.slice(0, 24)) : descText.length > 0,
  descText.slice(0, 40),
)
check('简介 labelled as sourced from bilibili', (await page.locator('.video-summary__source').innerText()).includes('哔哩哔哩'))
check('Bilibili counters shown', (await page.locator('.video-stat').count()) >= 5)
const embedSrc = await page.locator('.bp__iframe').getAttribute('src')
check('embed player iframe present', Boolean(embedSrc) && embedSrc.includes(sample.bvid), String(embedSrc))

// the floating player must fit its reserved slot exactly, or its info bar
// ("画面与弹幕由哔哩哔哩提供") spills onto the stats strip
const playerLayout = await page.evaluate(() => {
  const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null
  const slot = rect('.video-view__player-slot')
  const floating = rect('.gp')
  const stats = rect('.video-stats')
  if (!slot || !floating || !stats) return null
  return {
    slotBottom: Math.round(slot.bottom),
    playerBottom: Math.round(floating.bottom),
    statsTop: Math.round(stats.top),
    overflow: Math.round(floating.bottom - slot.bottom),
    statsOverlap: Math.round(
      Math.min(floating.bottom, stats.bottom) - Math.max(floating.top, stats.top),
    ),
  }
})
check('播放器高度与占位槽一致（信息条不溢出）', playerLayout && Math.abs(playerLayout.overflow) <= 2, JSON.stringify(playerLayout))
check('信息条没有压住统计栏', playerLayout && playerLayout.statsOverlap <= 0, JSON.stringify(playerLayout))

/* ---------------- 3b. B 站评论 ---------------- */
console.log('→ B 站评论')
await page.waitForTimeout(2500)
const biliCount = await page.locator('.bc-item').count()
check('B 站评论加载出来了', biliCount > 0, `count=${biliCount}`)
check(
  '评论标注来源为哔哩哔哩（只读）',
  (await page.locator('.bc__source').innerText()).includes('哔哩哔哩'),
)
if (biliCount > 0) {
  const first = page.locator('.bc-item').first()
  check('评论有昵称', (await first.locator('.bc-item__name').innerText()).trim().length > 0)
  check('评论有正文', (await first.locator('.bc-item__text').innerText()).trim().length > 0)
  check('评论有头像', (await first.locator('.bc-item__avatar img').count()) > 0)
}
await page.locator('.bc__sort .v-chip', { hasText: '最新' }).click()
await page.waitForTimeout(3000)
check('可切换到「最新」排序', (await page.locator('.bc-item').count()) > 0)
await page.locator('.bc__sort .v-chip', { hasText: '热门' }).click()
await page.waitForTimeout(2000)
await page.screenshot({ path: 'shots/23-bilibili-comments.png' })

/* ---------------- 3c. footer must not be covered ---------------- */
console.log('→ 页脚不被浮动层遮挡')
await page.locator('.comments-section__head .v-tab', { hasText: '本站评论' }).click()
await page.waitForTimeout(700)
check('本站评论有输入框', (await page.locator('.composer__input textarea').count()) > 0)
await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }))
await page.waitForTimeout(900)
const overlap = await page.evaluate(() => {
  const copy = document.querySelector('.footer__copy')
  const composer = document.querySelector('.bottom-composer')
  if (!copy || !composer) return { composer: Boolean(composer), copy: Boolean(copy) }
  const a = copy.getBoundingClientRect()
  const b = composer.getBoundingClientRect()
  return {
    composer: true,
    overlapX: Math.round(Math.min(a.right, b.right) - Math.max(a.left, b.left)),
    overlapY: Math.round(Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
  }
})
check(
  '版权文字没有被固定评论条遮住',
  !(overlap.overlapX > 0 && overlap.overlapY > 0),
  JSON.stringify(overlap),
)
await page.screenshot({ path: 'shots/24-footer-clearance.png' })

/* ---------------- 4. mini player ---------------- */
console.log('→ floating mini player')
const docked = await page.evaluate(() => {
  const gp = document.querySelector('.gp')
  const slot = document.querySelector('.video-view__player-slot')
  if (!gp || !slot) return null
  gp.__probe = 'kept-alive' // proves the element (and thus playback) is not recreated
  const g = gp.getBoundingClientRect()
  const s = slot.getBoundingClientRect()
  return {
    mini: gp.classList.contains('gp--mini'),
    dx: Math.round(Math.abs(g.top - s.top)),
    dy: Math.round(Math.abs(g.left - s.left)),
    dw: Math.round(Math.abs(g.width - s.width)),
    src: document.querySelector('.bp__iframe')?.src ?? '',
  }
})
check('player docks exactly onto the page slot', docked && !docked.mini && docked.dx < 2 && docked.dy < 2 && docked.dw < 2, JSON.stringify(docked))

await page.click('a.brand') // SPA navigation to home
await page.waitForTimeout(1600)
const mini = await page.evaluate(() => {
  const gp = document.querySelector('.gp')
  const r = gp?.getBoundingClientRect()
  return {
    mini: gp?.classList.contains('gp--mini') ?? false,
    survived: gp?.__probe === 'kept-alive',
    src: document.querySelector('.bp__iframe')?.src ?? '',
    bottomRight: r ? r.left > window.innerWidth / 2 && r.top > window.innerHeight / 2 : false,
    hasClose: Boolean(document.querySelector('.gp__bar button[aria-label="关闭小窗"]')),
    hasExpand: Boolean(document.querySelector('.gp__bar button[aria-label="回到视频页"]')),
  }
})
check('navigating away turns it into a mini window', mini.mini)
check('mini window sits in the bottom-right corner', mini.bottomRight)
check('the SAME player element survived (no reload)', mini.survived)
check('iframe src unchanged → playback continues', mini.src === docked.src, `${mini.src} vs ${docked.src}`)
check('mini window offers 回到视频页 / 关闭', mini.hasExpand && mini.hasClose)
await page.screenshot({ path: 'shots/20-mini-player.png' })

await page.click('.gp__bar button[aria-label="回到视频页"]')
await page.waitForTimeout(2000)
const back = await page.evaluate(() => {
  const gp = document.querySelector('.gp')
  const slot = document.querySelector('.video-view__player-slot')
  const g = gp?.getBoundingClientRect()
  const s = slot?.getBoundingClientRect()
  return {
    url: location.pathname,
    mini: gp?.classList.contains('gp--mini'),
    survived: gp?.__probe === 'kept-alive',
    aligned: g && s ? Math.abs(g.top - s.top) < 2 && Math.abs(g.width - s.width) < 2 : false,
  }
})
check('回到视频页 re-docks the player', back.mini === false && back.aligned, JSON.stringify(back))
check('still the same element after re-docking', back.survived === true)

await page.click('a.brand')
await page.waitForTimeout(1200)
await page.click('.gp__bar button[aria-label="关闭小窗"]')
await page.waitForTimeout(500)
check('关闭小窗 removes the player', (await page.locator('.gp').count()) === 0)

/* ---------------- 5. curated 分类 → home sections ---------------- */
console.log('→ curated 分类')
const collectionName = `自动化分类${Date.now() % 10000}`
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)

// the server may require ADMIN_TOKEN; the admin page asks for it once
if (health.authRequired) {
  check('后台要求管理口令时显示口令输入框', (await page.locator('#token-input').count()) === 1)
  if (TOKEN) {
    await page.locator('#token-input').fill(TOKEN)
    await page.locator('#token-save').click()
    await page.waitForTimeout(600)
  } else {
    notes.push('服务器要求 ADMIN_TOKEN，但未提供 → 写操作相关断言会失败')
  }
}

await page.locator('#collection-name').fill(collectionName)
await page.locator('#collection-add').click()
await page.waitForTimeout(1200)
const created = (await api.collections()).items.find((c) => c.name === collectionName)
check('admin creates a 分类', Boolean(created), JSON.stringify((await api.collections()).items))

// assign the sample video through the admin select
await page.locator(`.video[data-bvid="${sample.bvid}"] select[data-act="assign"]`).selectOption(created.id)
await page.waitForTimeout(1500)
const assigned = (await api.videos()).items.find((v) => v.bvid === sample.bvid)
check('admin assigns the video to the 分类', assigned.collectionId === created.id, String(assigned.collectionId))

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1800)
// the library may hold several 分类 — look through all sections, not just the first
const groupTitles = await page.locator('.group__title').allInnerTexts()
check(
  'home page shows the 分类 as a section',
  groupTitles.some((t) => t.includes(collectionName)),
  groupTitles.join(' | '),
)
check('section lists the assigned video', (await page.locator('.group .video-card').count()) >= 1)
const cardCollections = await page.locator('.video-card__collection').allInnerTexts()
check(
  'cards display the 分类 name',
  cardCollections.some((t) => t.includes(collectionName)),
  cardCollections.join(' | '),
)
await page.screenshot({ path: 'shots/21-home-collections.png', fullPage: false })
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)
await page.screenshot({ path: 'shots/22-admin-collections.png', fullPage: false })
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1400)

// chip filtering
await page.locator('.categories .v-chip', { hasText: collectionName }).first().click()
await page.waitForTimeout(1200)
check('chip filters the feed to that 分类', (await page.locator('.feed__count').innerText()).includes('1'))

// video page shows the 分类 chip and links back to it
await page.goto(`${BASE}/video/${sample.bvid}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2200)
check('video page shows the 分类 chip', (await page.locator('.video-header__meta .v-chip').first().innerText()).includes(collectionName))

// cleanup: restore the original 分类 (usually none) and delete the temp 分类
console.log('→ cleanup')
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)
await page
  .locator(`.video[data-bvid="${sample.bvid}"] select[data-act="assign"]`)
  .selectOption(originalCollectionId)
await page.waitForTimeout(1200)
await page.locator(`.collection-item:has-text("${collectionName}") button[data-act="delete"]`).click()
await page.waitForTimeout(1500)
const afterCleanup = await api.collections()
check('cleanup: 分类 removed', !afterCleanup.items.some((c) => c.name === collectionName))
check(
  'cleanup: video kept with its original 分类',
  (await api.videos()).items.some(
    (v) => v.bvid === sample.bvid && v.collectionId === originalCollectionId,
  ),
)

/* ---------------- 6. favourites + local comments ---------------- */
console.log('→ favourites + comments')
await page.goto(`${BASE}/video/${sample.bvid}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
const favBtn = page.locator('.video-actions button:has-text("加入我的收藏")').first()
if (await favBtn.count()) {
  await favBtn.click()
  await page.waitForTimeout(600)
}
await page.goto(`${BASE}/favorites`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1400)
check('favourite appears on the favourites page', (await page.locator('.video-card').count()) > 0)

await page.goto(`${BASE}/video/${sample.bvid}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
// local comments live in the second tab
await page.locator('.comments-section__head .v-tab', { hasText: '本站评论' }).click()
await page.waitForTimeout(700)
const commentText = `检查评论 ${Date.now() % 10000}`
await page.locator('.composer__input textarea:not([readonly])').first().fill(commentText)
await page.locator('.composer__actions button:has-text("发布")').click()
await page.waitForTimeout(900)
check('local comment posted', await page.evaluate((t) => document.body.innerText.includes(t), commentText))
check('comment section labelled local-only', (await page.locator('.comments__hint').innerText()).includes('不会同步到 B 站'))

/* ---------------- 7. admin validation ---------------- */
console.log('→ admin validation')
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
await page.locator('#input').fill('这不是一个bv号')
await page.locator('#submit').click()
await page.waitForTimeout(3500)
const errText = await page.locator('.result.err').first().innerText()
check('invalid bvid rejected with a reason', /失败/.test(errText) && /无法识别|不存在|请检查/.test(errText), errText)

/* ---------------- 8. deferred 投稿 (待补齐) ---------------- */
console.log('→ 待补齐（延迟元数据）')
// A real bvid, so the embed player behaves — what is simulated here is B 站
// refusing the metadata fetch (412), which is answered by the route below.
const pendingCandidates = ['BV1xx411c7mD', 'BV1Q541167Qg', 'BV1uv411q7Mv', 'BV1zzzzzzzz']
const knownBvids = new Set((await api.videos()).items.map((v) => v.bvid))
const pendingBvid = pendingCandidates.find((b) => !knownBvids.has(b))

if (!pendingBvid) {
  notes.push('跳过「待补齐」UI 断言：候选 bvid 都已在库中')
} else {
  const created = await fetch(`${BASE}/api/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { 'X-Admin-Token': TOKEN } : {}) },
    body: JSON.stringify({ input: pendingBvid, deferMetadata: true }),
  }).then((r) => r.json())
  check('后台「只存链接」收录为待补齐', created.results?.[0]?.item?.metadataState === 'pending', JSON.stringify(created.results?.[0]?.error || ''))

  // keep the page pending by answering the automatic retry locally — the
  // comments endpoint would otherwise resolve the aid and fill the record in too
  await page.route('**/api/videos/*/hydrate', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        hydrated: false,
        pending: true,
        error: '（自动化测试：B 站暂时拒绝了请求）',
      }),
    }),
  )
  await page.route('**/api/comments/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        replies: [],
        next: 0,
        isEnd: true,
        total: 0,
        modeName: '热门评论',
        cached: false,
      }),
    }),
  )

  await page.goto(`${BASE}/video/${pendingBvid}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  check('待补齐视频页显示提示条', await page.locator('.video-view__pending').isVisible())
  check('提示条提供「立刻补齐」按钮', (await page.locator('.video-view__pending button').count()) > 0)
  check('没有编造 UP 主卡片', (await page.locator('.video-header__up').count()) === 0)
  check('不显示全 0 的统计栏', (await page.locator('.video-stats').count()) === 0)
  check(
    '标题栏标明元数据待补齐',
    (await page.locator('.video-header__meta .v-chip').first().innerText()).includes('待补齐'),
  )
  check(
    '待补齐视频依然能打开播放器',
    ((await page.locator('.bp__iframe').getAttribute('src')) || '').includes(pendingBvid),
  )
  await page.screenshot({ path: 'shots/25-pending-metadata.png' })

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2600)
  const pendingCards = await page.locator('.video-card__pending').count()
  check(
    '主页为待补齐视频渲染占位封面',
    pendingCards > 0,
    `placeholders=${pendingCards} cards=${await page.locator('.video-card').count()}`,
  )
  await page.screenshot({ path: 'shots/26-pending-card.png' })

  // the admin page must show the pending state, not a broken card
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1600)
  const adminCard = page.locator(`.video[data-bvid="${pendingBvid}"]`)
  check('后台卡片标出「待补齐」', (await adminCard.locator('.chip').count()) === 1)
  check('后台提供「补齐元数据」按钮', (await adminCard.locator('button[data-act="hydrate"]').count()) === 1)
  check('后台缩略图使用占位块', (await adminCard.locator('.thumb.pending').count()) === 1)

  await page.unroute('**/api/videos/*/hydrate')
  await page.unroute('**/api/comments/**')

  // the retry endpoint itself: public, throttled after the first attempt, and
  // (for a real bvid) it fills the record in
  const retry = await fetch(`${BASE}/api/videos/${pendingBvid}/hydrate`, { method: 'POST' }).then((r) =>
    r.json(),
  )
  check(
    '补齐接口无需口令即可调用并把元数据补齐',
    retry.hydrated === true && retry.item.metadataState === 'complete' && Boolean(retry.item.cover),
    JSON.stringify({ hydrated: retry.hydrated, error: retry.error }),
  )
  const throttled = await fetch(`${BASE}/api/videos/${pendingBvid}/hydrate`, { method: 'POST' }).then((r) =>
    r.json(),
  )
  check('补齐接口有频率限制', throttled.throttled === true, JSON.stringify(throttled).slice(0, 120))

  await fetch(`${BASE}/api/videos/${pendingBvid}`, {
    method: 'DELETE',
    headers: TOKEN ? { 'X-Admin-Token': TOKEN } : {},
  })
  check(
    'cleanup: 待补齐测试视频已移除',
    !(await api.videos()).items.some((v) => v.bvid === pendingBvid),
  )
}

await browser.close()

console.log(`\n${passed} passed, ${failed} failed`)
notes.forEach((n) => console.log('ℹ ' + n))
if (problems.length) {
  console.log('⚠ runtime problems:')
  problems.forEach((p) => console.log('  ' + p))
}
process.exit(failed > 0 || problems.length > 0 ? 1 : 0)
