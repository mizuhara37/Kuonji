/**
 * Verify a DEPLOYED instance (Vercel or any host).
 *
 *   node scripts/check-deployed.mjs https://your-app.vercel.app
 *   DEPLOY_URL=... npm run check:deployed
 *
 * Checks the things that can differ between local and the cloud: the seed
 * fallback, read-only storage behaviour, auth ordering, the image proxy and —
 * most importantly — whether the host can reach api.bilibili.com at all.
 */
import '../server/env.js'

const BASE = (process.argv[2] || process.env.DEPLOY_URL || '').replace(/\/$/, '')
const TOKEN = process.env.ADMIN_TOKEN || ''

if (!BASE) {
  console.error('用法: node scripts/check-deployed.mjs <https://your-app.vercel.app>')
  process.exit(1)
}

let passed = 0
let failed = 0
let warned = 0
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  ✔ ${name}`)
  } else {
    failed += 1
    console.log(`  ✘ ${name} ${detail}`)
  }
}

async function api(path, { method = 'GET', body, token = TOKEN } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['X-Admin-Token'] = token
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (err) {
    data = { raw: text.slice(0, 200) }
  }
  return { status: res.status, data }
}

console.log(`验证线上实例：${BASE}\n`)

/* ---------------- health + storage ---------------- */
console.log('→ 健康检查与存储')
const health = (await api('/health')).data
check('函数可用', health?.ok === true, JSON.stringify(health))
check('库内容可用', Number(health?.library) > 0, `library=${health?.library}`)
check('管理口令已生效', health?.authRequired === true, `authRequired=${health?.authRequired}`)
console.log(
  `  ℹ driver=${health?.driver} canWrite=${health?.canWrite} storage=${health?.storage} library=${health?.library} collections=${health?.collections}`,
)
const writable = health?.canWrite === true
console.log(
  writable
    ? '  ℹ 可写部署（已配置 KV）：下面会验证真实写入与持久化'
    : '  ℹ 只读部署（未配置 KV）：下面会验证写操作被正确拦下并给出提示',
)

/* ---------------- content ---------------- */
console.log('\n→ 内容接口')
const list = (await api('/videos')).data
check('视频列表可用', list?.total > 0, `total=${list?.total}`)
const seeded = list?.items?.[0]
check(
  '记录字段完整（UP / 统计 / 分 P）',
  Boolean(seeded?.owner?.name && typeof seeded?.stat?.view === 'number' && seeded?.pages?.length),
  JSON.stringify(seeded && { up: seeded.owner.name, view: seeded.stat.view }),
)
check('分类随部署提供', Array.isArray((await api('/collections')).data?.items), '')
check('单条查询可用', (await api(`/videos/${seeded.bvid}`)).status === 200)

/* ---------------- pages ---------------- */
console.log('\n→ 页面')
const home = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(30000) })
const homeText = await home.text()
check('首页返回 SPA', home.ok && homeText.includes('<div id="app">'), `HTTP ${home.status}`)
const admin = await fetch(`${BASE}/admin`, { signal: AbortSignal.timeout(30000) })
const adminText = await admin.text()
check('/admin 返回后台页面', admin.ok && adminText.includes('投稿后台'), `HTTP ${admin.status}`)

// Deep links must resolve to the SPA too, otherwise refresh / share breaks.
for (const path of [`/video/${seeded.bvid}`, '/search', '/favorites', '/nope']) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(30000) })
  const text = await res.text()
  check(
    `深链接 ${path} 落到 SPA（可直接刷新）`,
    res.ok && text.includes('<div id="app">'),
    `HTTP ${res.status}`,
  )
}

/* ---------------- writes: adaptive to the deployment's storage mode ---------------- */
console.log('\n→ 写操作')
check('不带口令 → 401', (await api('/videos', { method: 'POST', body: { input: 'x' }, token: '' })).status === 401)

if (!TOKEN) {
  console.log('  ℹ 未读到 ADMIN_TOKEN，跳过其余写操作断言')
} else if (!writable) {
  const write = await api('/videos', { method: 'POST', body: { input: seeded.bvid } })
  check('只读部署：写操作被拦下（503）', write.status === 503, `HTTP ${write.status}`)
  check(
    '提示明确指向 KV 配置',
    /KV_REST_API_URL|UPSTASH_REDIS_REST_URL/.test(String(write.data?.error || '')),
    String(write.data?.error).slice(0, 90),
  )
} else {
  // 1. publishing / refreshing through the Bilibili API (retry once: upstream hiccups)
  let write = await api('/videos', { method: 'POST', body: { input: seeded.bvid } })
  if (write.status !== 200) {
    await new Promise((r) => setTimeout(r, 2500))
    write = await api('/videos', { method: 'POST', body: { input: seeded.bvid } })
  }
  const upstreamBlocked = /风控|频繁|412|429/.test(
    String(write.data?.results?.[0]?.error || write.data?.error || ''),
  )
  if (upstreamBlocked) {
    // Bilibili rate-limits datacentre IPs; that is an upstream condition, not a
    // bug in this deployment. Report it without failing the suite.
    console.log(
      `  ⚠ B 站元数据接口暂时拦截了该出口 IP（${write.status}）——投稿/刷新会失败，浏览与评论不受影响`,
    )
    warned += 1
  } else {
    check(
      '可写部署：投稿/刷新成功',
      write.status === 200 && (write.data?.refreshed > 0 || write.data?.added > 0),
      `HTTP ${write.status} ${JSON.stringify(write.data?.results?.[0]?.error || write.data).slice(0, 140)}`,
    )
  }

  // 2. a real round trip that proves persistence in the external store
  const name = `线上自检${Date.now() % 10000}`
  const created = await api('/collections', { method: 'POST', body: { name } })
  check('可写部署：新建分类成功', created.status === 200 && created.data?.item?.name === name, JSON.stringify(created.data).slice(0, 120))

  if (created.status === 200) {
    const id = created.data.item.id
    const original = (await api(`/videos/${seeded.bvid}`)).data.item.collectionId || ''
    await api(`/videos/${seeded.bvid}`, { method: 'PATCH', body: { collectionId: id } })

    // read it back from a *fresh request* — this is what proves KV persistence
    const afterAssign = (await api(`/videos/${seeded.bvid}`)).data.item
    check('可写部署：归类已持久化（回读一致）', afterAssign.collectionId === id, `collectionId=${afterAssign.collectionId}`)

    const list = (await api(`/videos?collection=${id}`)).data
    check('可写部署：按分类筛选能查到该视频', list.items.some((v) => v.bvid === seeded.bvid), `total=${list.total}`)

    // 3. cleanup + restore the original assignment
    await api(`/videos/${seeded.bvid}`, { method: 'PATCH', body: { collectionId: original } })
    await api(`/collections/${id}`, { method: 'DELETE' })
    const afterCleanup = (await api('/collections')).data.items
    const restored = (await api(`/videos/${seeded.bvid}`)).data.item
    check('可写部署：清理后分类已删除', !afterCleanup.some((c) => c.id === id))
    check('可写部署：视频分类已还原', restored.collectionId === original, `collectionId=${restored.collectionId}`)
  }
}

/* ---------------- upstream (the risky part on Vercel) ---------------- */
console.log('\n→ B 站上游（Vercel 在海外节点，这一项最可能受限）')
const comments = await api(`/comments/${seeded.bvid}?mode=hot`)
check('B 站评论接口可用', comments.status === 200 && Array.isArray(comments.data?.replies), `HTTP ${comments.status} ${JSON.stringify(comments.data).slice(0, 120)}`)
console.log(`  ℹ 评论数=${comments.data?.total ?? '-'} 本页=${comments.data?.replies?.length ?? 0}`)

const img = await fetch(`${BASE}/api/image?url=${encodeURIComponent(seeded.cover)}`, {
  signal: AbortSignal.timeout(30000),
})
check(
  '图床代理可用',
  img.ok && (img.headers.get('content-type') || '').startsWith('image/'),
  `HTTP ${img.status} ${img.headers.get('content-type')}`,
)

console.log(
  `\n${passed} passed, ${failed} failed${warned ? `, ${warned} warning（上游限制，非本站问题）` : ''}`,
)
process.exit(failed ? 1 : 0)
