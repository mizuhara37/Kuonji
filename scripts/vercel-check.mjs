/**
 * Pre-flight check for a Vercel deployment.
 *
 * Simulates the real serverless environment locally:
 *   • runs api/index.js the way Vercel does (a (req,res) handler)
 *   • VERCEL=1  → no writable filesystem
 *   • M37_DATA_DIR points at an EMPTY temp dir → no stored library exists,
 *     exactly like a fresh deployment, so the committed seed must kick in
 *   • ADMIN_TOKEN from .env → writes are token-gated
 *
 *   npm run check:vercel
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import '../server/env.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.SIM_PORT || 8899)
const BASE = `http://127.0.0.1:${PORT}`
const TOKEN = process.env.ADMIN_TOKEN || ''

let passed = 0
let failed = 0
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
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (err) {
    data = { raw: text.slice(0, 200) }
  }
  return { status: res.status, data, text }
}

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`)
      if (res.ok) return true
    } catch (err) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

const dataDir = await mkdtemp(join(tmpdir(), 'm37-vercel-sim-'))
console.log(`→ 启动无状态函数宿主（空数据目录：${dataDir}）`)

const child = spawn(process.execPath, [join(ROOT, 'scripts', 'vercel-function-host.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    VERCEL: '1',
    VERCEL_ENV: 'production',
    M37_DATA_DIR: dataDir,
    NODE_ENV: 'production',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.on('data', (d) => process.stdout.write(`  [fn] ${d}`))
child.stderr.on('data', (d) => process.stderr.write(`  [fn:err] ${d}`))

let ok = false
try {
  ok = await waitForServer()
  check('无状态函数启动并响应', ok)
  if (!ok) throw new Error('函数宿主未启动')

  /* ---------------- reads work, seed is used ---------------- */
  console.log('→ 只读环境下的读取（应使用 seed）')
  const health = (await api('/health')).data
  check('health 正常', health.ok === true, JSON.stringify(health))
  check('识别为不可写（Vercel 只读文件系统）', health.canWrite === false, `canWrite=${health.canWrite}`)
  check('报告需要管理口令', health.authRequired === true, `authRequired=${health.authRequired}`)

  const list = (await api('/videos')).data
  check('seed 内容被当作库内容提供', list.total >= 1, `total=${list.total}`)
  const seeded = list.items[0]
  check(
    'seed 记录被归一化（owner / stat / pages 齐全）',
    Boolean(seeded?.owner?.name && typeof seeded?.stat?.view === 'number' && seeded?.pages?.length),
    JSON.stringify(seeded && { up: seeded.owner.name, view: seeded.stat.view, pages: seeded.pages.length }),
  )
  check('封面走图床代理', String(seeded?.cover || '').startsWith('https://'), String(seeded?.cover))

  const collections = (await api('/collections')).data
  check('seed 分类也被提供', Array.isArray(collections.items), `count=${collections.items?.length}`)

  const single = await api(`/videos/${seeded.bvid}`)
  check('单条查询可用', single.status === 200 && single.data.item.bvid === seeded.bvid, String(single.status))

  /* ---------------- static assets ---------------- */
  console.log('→ 静态资源与后台页面')
  const home = await fetch(`${BASE}/`)
  const homeText = await home.text()
  check('站点首页可访问（dist/index.html）', home.ok && homeText.includes('<div id="app">'), `HTTP ${home.status}`)
  const admin = await fetch(`${BASE}/admin`)
  const adminText = await admin.text()
  check('后台页面可访问', admin.ok && adminText.includes('投稿后台'), `HTTP ${admin.status}`)

  /* ---------------- writes are gated ---------------- */
  console.log('→ 写操作：先鉴权，再报告存储不可写')
  const noToken = await api('/videos', { method: 'POST', body: { input: seeded.bvid }, token: '' })
  check('不带口令 → 401', noToken.status === 401, `HTTP ${noToken.status}`)

  if (TOKEN) {
    const write = await api('/videos', { method: 'POST', body: { input: seeded.bvid } })
    check('带口令但无 KV → 503', write.status === 503, `HTTP ${write.status} ${JSON.stringify(write.data)}`)
    check(
      '错误信息明确指向 KV 配置',
      /KV_REST_API_URL|UPSTASH_REDIS_REST_URL/.test(String(write.data?.error || '')),
      String(write.data?.error),
    )
    const del = await api(`/videos/${seeded.bvid}`, { method: 'DELETE' })
    check('删除同样被拦下并给出同一提示', del.status === 503, `HTTP ${del.status}`)
    const collectionWrite = await api('/collections', { method: 'POST', body: { name: 'x' } })
    check('分类写入同样被拦下', collectionWrite.status === 503, `HTTP ${collectionWrite.status}`)
  } else {
    console.log('  ℹ 未提供 ADMIN_TOKEN，跳过写操作断言')
  }

  /* ---------------- upstream still reachable ---------------- */
  console.log('→ B 站上游')
  const comments = await api(`/comments/${seeded.bvid}?mode=hot`)
  check(
    'B 站评论接口在只读部署下仍可用',
    comments.status === 200 && Array.isArray(comments.data.replies),
    `HTTP ${comments.status} ${JSON.stringify(comments.data).slice(0, 120)}`,
  )
} catch (err) {
  failed += 1
  console.log(`  ✘ 模拟运行失败：${err.message}`)
} finally {
  child.kill()
  await rm(dataDir, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
