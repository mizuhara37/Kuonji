/**
 * 本地补齐 → 上传线上（Vercel KV）的辅助工具。
 *
 * B 站会按出口 IP 封线上机房（`412 request was banned`），所以线上可能留下
 * 「只存了 bvid」的待补齐记录。本机是家宽 IP，抓元数据没问题 —— 于是：
 *
 *   npm run sync -- list          # 1. 看线上有哪些视频、哪些缺元数据
 *   npm run sync -- hydrate       # 2. 用本机 IP 抓 B 站，补齐本地记录
 *   npm run sync -- push          # 3. 把补齐好的记录上传到线上（不需要 B 站）
 *   npm run sync -- run           # 一条龙：list → hydrate → push → 回读校验
 *
 * 常用参数
 *   --base <url>      线上地址（默认 LIVE_BASE → config.json 的 deployUrl → 本地 8787）
 *   --bvids A,B       只处理指定 bvid（默认：线上所有「需要补齐」的记录）
 *   --all             连已经完整的记录也重新抓一遍（刷新数据/统计）
 *   --dry             只演练，不写本地也不上传
 *   --no-store        只在内存里补齐，不改本地库
 *   --direct          不用本地服务，直接写本地 JSON 文件（服务未运行时是默认）
 *   --local <url>     本地服务地址（默认 http://127.0.0.1:8787）
 *   --delay <ms>      抓取间隔（默认 1200，降低被 B 站限流的概率）
 *   --limit <n>       最多处理多少条
 *   --with-collection 连本地分类一起覆盖线上（默认以线上策展为准，不动分类）
 *   --json            `list` 输出 JSON（给脚本用）
 *
 * 鉴权：ADMIN_TOKEN（默认从 .env 读取）
 * 网络：这台机器的 DNS 会把 *.vercel.app 解析到错误 IP，需要走系统代理：
 *   $env:HTTPS_PROXY="http://127.0.0.1:7897"; $env:NODE_USE_ENV_PROXY="1"
 */
import '../server/env.js' // 最先加载 .env（ADMIN_TOKEN）

import { fetchVideoMeta } from '../server/bilibili.js'
import { driver } from '../server/backend.js'
import { config } from '../server/config.js'
import * as store from '../server/store.js'

const ARGV = process.argv.slice(2)
/** 线上地址：LIVE_BASE（可放 .env）→ config.json 的 deployUrl → 本地服务。 */
const DEFAULT_BASE = process.env.LIVE_BASE || config.deployUrl || 'http://127.0.0.1:8787'

const COMMANDS = ['list', 'hydrate', 'push', 'run', 'help']
const command = COMMANDS.includes(ARGV[0]) ? ARGV[0] : ARGV[0] === undefined ? 'list' : ARGV[0]

function flag(name) {
  return ARGV.includes(`--${name}`)
}
function option(name, fallback = '') {
  const i = ARGV.indexOf(`--${name}`)
  return i === -1 ? fallback : ARGV[i + 1] ?? fallback
}

const BASE = (option('base', process.env.LIVE_BASE || DEFAULT_BASE)).replace(/\/$/, '')
const TOKEN = process.env.ADMIN_TOKEN || ''
const LOCAL_BASE = (
  option('local', process.env.LOCAL_BASE || `http://127.0.0.1:${process.env.PORT || 8787}`)
).replace(/\/$/, '')
const DRY = flag('dry')
const NO_STORE = flag('no-store')
const DELAY = Math.max(0, Number(option('delay', '1200')) || 0)
const LIMIT = Number(option('limit', '0')) || 0
const BVIDS = option('bvids', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const ALL = flag('all')
const AS_JSON = flag('json')

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/** 终端对齐：中文与 emoji 按 2 列宽度计算 */function width(text) {
  let n = 0
  for (const ch of String(text ?? '')) {
    n += /[\u1100-\u115f\u2190-\u21ff\u2300-\u23ff\u2460-\u24ff\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u2600-\u27bf\u2b00-\u2bff\ufe0f]|\u{1f000}-\u{1faff}/u.test(
      ch,
    )
      ? 2
      : 1
  }
  return n
}
function pad(text, cols) {
  const value = String(text ?? '')
  const w = width(value)
  if (w > cols) {
    let out = ''
    let used = 0
    for (const ch of value) {
      const cw = width(ch)
      if (used + cw > cols - 1) return `${out}…`
      out += ch
      used += cw
    }
    return out
  }
  return value + ' '.repeat(cols - w)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(path, { method = 'GET', body, auth = true, timeout = 45000 } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth && TOKEN) headers['X-Admin-Token'] = TOKEN
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
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

function hintProxy(err) {
  const msg = String(err?.message || err || '')
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timeout|abort/i.test(msg)) {
    console.error(`
  提示：无法连接 ${BASE}。这台机器的 DNS 会把 *.vercel.app 解析到错误 IP，
  需要让 Node 走系统代理后重试：
    $env:HTTPS_PROXY="http://127.0.0.1:7897"
    $env:HTTP_PROXY="http://127.0.0.1:7897"
    $env:NODE_USE_ENV_PROXY="1"
`)
  }
}

/* ------------------------------------------------------------------ *
 * 缺什么 / 要不要补
 * ------------------------------------------------------------------ */

/** 简介与标签本来就可能是空的，所以它们只作为提示，不作为「需要补齐」的依据。 */
function missingFields(video) {
  const missing = []
  if (!video.cover) missing.push('封面')
  if (!video.owner?.mid) missing.push('UP主')
  if (!video.aid) missing.push('aid')
  if (!video.title || video.title === video.bvid) missing.push('标题')
  if (!video.pages?.length || !video.pages[0]?.cid) missing.push('分P')
  if (video.categoryParent === '未分区') missing.push('分区')
  if (!video.tags?.length) missing.push('标签(可空)')
  if (!video.desc) missing.push('简介(可空)')
  return missing
}

const BLOCKING = new Set(['封面', 'UP主', 'aid', '标题', '分P', '分区'])

function needsHydration(video) {
  if (video.metadataState === 'pending') return true
  return missingFields(video).some((f) => BLOCKING.has(f))
}

async function loadLive() {
  let list
  try {
    list = await api('/videos')
  } catch (err) {
    hintProxy(err)
    throw err
  }
  if (list.status !== 200) {
    throw new Error(`读取线上视频列表失败：HTTP ${list.status} ${JSON.stringify(list.data).slice(0, 160)}`)
  }
  let collections = { items: [] }
  try {
    collections = await api('/collections')
  } catch (err) {
    /* 分类读不到不影响补齐 */
  }
  return { items: list.data.items || [], collections: collections.data?.items || [] }
}

/* ------------------------------------------------------------------ *
 * list —— 看线上有哪些视频
 * ------------------------------------------------------------------ */

async function runList({ print = true } = {}) {
  const health = (await api('/health')).data
  const { items, collections } = await loadLive()

  const rows = items.map((v) => ({
    bvid: v.bvid,
    state: v.metadataState === 'pending' ? '待补齐' : '完整',
    missing: missingFields(v),
    need: needsHydration(v),
    title: v.title,
    up: v.owner?.mid ? v.owner.name : '',
    collection: v.collectionName || '',
    aid: Boolean(v.aid),
    cover: Boolean(v.cover),
    tags: v.tags?.length || 0,
    parts: v.partCount || v.pages?.length || 0,
  }))

  if (AS_JSON) {
    console.log(JSON.stringify({ base: BASE, health: health || null, collections, items: rows }, null, 2))
    return { items, rows }
  }

  const need = rows.filter((r) => r.need)
  if (print) {
    console.log(`线上：${BASE}`)
    console.log(
      `存储：${health?.storage || '未知'} · ${
        health?.canWrite ? '可写' : '只读'
      } · 口令：${health?.authRequired ? '已启用' : '未设置'}${TOKEN ? '' : '（未读到 ADMIN_TOKEN，写操作会 401）'}`,
    )
    console.log(`视频 ${items.length} 个 / 分类 ${collections.length} 个\n`)

    console.log(
      `${pad('#', 3)}${pad('状态', 9)}${pad('bvid', 15)}${pad('标题', 34)}${pad('UP 主', 14)}${pad('分类', 10)}缺失`,
    )
    console.log('-'.repeat(112))
    rows.forEach((r, i) => {
      console.log(
        `${pad(i + 1, 3)}${pad(r.state === '完整' ? '✅ 完整' : '⏳ 待补齐', 9)}${pad(r.bvid, 15)}${pad(
          r.title,
          34,
        )}${pad(r.up || '-', 14)}${pad(r.collection || '-', 10)}${pad(r.missing.join(','), 30)}`,
      )
    })
    console.log(`\n汇总：${items.length} 个视频，其中 ${need.length} 个需要补齐`)
    if (need.length) {
      console.log(`  ${need.map((r) => r.bvid).join(' ')}`)
      console.log('\n下一步：npm run sync -- run        # 本机补齐并上传（或分开用 hydrate / push）')
    } else {
      console.log('  线上的元数据都是齐的，不需要补齐。')
    }
  }
  return { items, rows }
}

/* ------------------------------------------------------------------ *
 * hydrate —— 用本机 IP 抓 B 站，把记录补进本地库
 * ------------------------------------------------------------------ */

let localIndex = new Map()
async function loadLocal() {
  const local = await localItems()
  localIndex = new Map(local.map((v) => [v.bvid, v]))
  return local
}

/**
 * 本地库的落地方式有两条路：
 *   server —— 本地服务正在运行（`npm run start`）：让它自己抓、自己写。
 *             直接写文件是不安全的：服务进程持有一份内存缓存，
 *             它下一次写入（归类 / 删除 / 投稿）会把我们的改动整份覆盖掉。
 *   file   —— 没有本地服务：直接调 bilibili.js + store.js 写 JSON 文件。
 */
const localServer = { mode: 'file', base: LOCAL_BASE, driver: driver, probed: false }

async function probeLocalServer() {
  try {
    const res = await fetch(`${LOCAL_BASE}/api/health`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return null
    const data = await res.json()
    return data?.ok ? data : null
  } catch (err) {
    return null
  }
}

/** 决定「本地」是走 HTTP 还是文件（只探测一次）。 */
async function ensureLocalMode() {
  if (localServer.probed) return localServer
  const probe = flag('direct') ? null : await probeLocalServer()
  localServer.mode = probe ? 'server' : 'file'
  localServer.driver = probe?.driver || driver
  localServer.probed = true
  return localServer
}

/** 本地库列表（server 模式走 HTTP，避免跟服务的缓存打架） */
async function localItems() {
  if (localServer.mode === 'server') {
    const res = await fetch(`${LOCAL_BASE}/api/videos`, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`读取本地服务失败：HTTP ${res.status}`)
    return (await res.json()).items || []
  }
  return store.list()
}

/** 抓一条元数据并落到本地库，返回完整记录 */
async function hydrateOne(bvid) {
  if (localServer.mode === 'server' && !DRY && !NO_STORE) {
    const res = await fetch(`${LOCAL_BASE}/api/videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(TOKEN ? { 'X-Admin-Token': TOKEN } : {}),
      },
      body: JSON.stringify({ input: bvid }),
      signal: AbortSignal.timeout(45000),
    })
    const data = await res.json().catch(() => null)
    const result = data?.results?.[0]
    if (res.status !== 200 || !result?.ok) {
      const err = new Error(result?.error || data?.error || `本地服务返回 HTTP ${res.status}`)
      err.code = res.status
      throw err
    }
    return result.item
  }

  const meta = await fetchVideoMeta(bvid)
  if (!DRY && !NO_STORE && localServer.mode === 'file') {
    await store.applyMetadata(meta.bvid, meta)
  }
  return meta
}

/** 目标集合：显式 --bvids > 线上需要补齐的记录（--all 则全部） */
async function targets() {
  if (BVIDS.length) {
    return BVIDS.map(
      (bvid) =>
        localIndex.get(bvid) || {
          bvid,
          metadataState: 'pending',
          title: bvid,
          owner: {},
          stat: {},
          pages: [],
        },
    )
  }
  const { items } = await loadLive()
  const list = ALL ? items : items.filter(needsHydration)
  return LIMIT ? list.slice(0, LIMIT) : list
}

async function runHydrate() {
  await ensureLocalMode()
  const local = await loadLocal()
  const list = await targets()
  if (!list.length) {
    console.log('没有需要补齐的记录（用 --all 可以强制全部重新抓一遍）。')
    return []
  }

  console.log(
    localServer.mode === 'server'
      ? `补齐方式：本地服务 ${LOCAL_BASE}（driver=${localServer.driver}）—— 由它抓取并写入本地库`
      : `补齐方式：直接写本地库（driver=${localServer.driver}${
          localServer.driver === 'file' ? '，server/data/videos.json' : '，即线上 KV'
        }）`,
  )
  if (localServer.mode === 'file' && !flag('direct')) {
    const running = await probeLocalServer()
    if (running) {
      console.warn(
        '⚠ 检测到本地服务在运行，但本次用「直接写文件」方式：它的内存缓存可能会在下次写入时覆盖本次结果。',
      )
    }
  }
  if (flag('direct')) {
    const running = await probeLocalServer()
    if (running) {
      console.warn(
        '⚠ --direct 指定了直接写文件，而本地服务正在运行：建议去掉 --direct，或先停掉本地服务（Ctrl+C）。',
      )
    }
  }
  console.log(`本地库现有 ${local.length} 条；本次目标 ${list.length} 条：${list.map((v) => v.bvid).join(' ')}\n`)

  const hydrated = []
  const failed = []
  for (const [index, item] of list.entries()) {
    if (index && DELAY) await sleep(DELAY)
    process.stdout.write(`[${index + 1}/${list.length}] ${item.bvid} … `)
    try {
      const existed = localIndex.has(item.bvid)
      const meta = await hydrateOne(item.bvid)
      hydrated.push(meta)
      console.log(
        `✔ ${meta.metadataSource === 'html' ? '视频页' : '接口'} · ${meta.title} · UP ${meta.owner.name} · ${
          meta.partCount
        }P${existed ? '' : '（本地新增）'}`,
      )
    } catch (err) {
      failed.push({ bvid: item.bvid, error: err.message, code: err.code })
      console.log(`✘ ${err.message}`)
    }
  }

  console.log(`\n补齐成功 ${hydrated.length} / 失败 ${failed.length}${DRY ? '（--dry：未写本地库）' : ''}`)
  if (failed.length) {
    for (const f of failed) console.log(`  ✘ ${f.bvid} → ${f.code || ''} ${f.error}`)
  }
  if (hydrated.length && !DRY && !NO_STORE && localServer.driver === 'file') {
    console.log('本地库已更新；如需把这份内容写进提交版 seed：npm run seed:export')
  }
  return hydrated
}

/* ------------------------------------------------------------------ *
 * push —— 把本地记录上传到线上（不经过 B 站）
 * ------------------------------------------------------------------ */

async function recordsForPush(hydratedHint) {
  await ensureLocalMode()
  const wanted = BVIDS.length
    ? new Set(BVIDS)
    : hydratedHint?.length
      ? new Set(hydratedHint.map((v) => v.bvid))
      : null

  await loadLocal()
  const all = await localItems()
  const pool = wanted ? all.filter((v) => wanted.has(v.bvid)) : all.filter(needsHydration)
  return LIMIT ? pool.slice(0, LIMIT) : pool
}

async function runPush(hydratedHint = []) {
  if (!TOKEN) {
    console.error('缺少 ADMIN_TOKEN（写在 .env 或设置环境变量），无法上传。')
    process.exitCode = 1
    return []
  }

  const records = await recordsForPush(hydratedHint)
  if (!records.length) {
    console.log('没有需要上传的记录（本地库都已是完整的，或用 --bvids 指定）。')
    return []
  }

  // 上传前先记录线上分类，push 之后要确认策展没有被覆盖
  const before = await loadLive()
  const beforeById = new Map(before.items.map((v) => [v.bvid, v]))

  console.log(`上传 ${records.length} 条到 ${BASE}${DRY ? '（--dry：不会真的写）' : ''}`)
  if (DRY) {
    records.forEach((r) => console.log(`  · ${r.bvid} ${r.title}`))
    return records
  }

  const BATCH = 25
  const results = []
  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH)
    const payload = {
      records: chunk.map((v) => ({
        bvid: v.bvid,
        aid: v.aid,
        cid: v.cid,
        title: v.title,
        desc: v.desc,
        cover: v.cover,
        duration: v.duration,
        pubdate: v.pubdate,
        category: v.category,
        categoryParent: v.categoryParent,
        tags: v.tags,
        owner: v.owner,
        stat: v.stat,
        pages: v.pages,
        metadataSource: v.metadataSource || 'local',
        ...(flag('with-collection') ? { collectionId: v.collectionId || '' } : {}),
      })),
      withCollection: flag('with-collection'),
    }
    const res = await api('/videos/import', { method: 'POST', body: payload })
    if (res.status === 404) {
      console.error(
        `\n✘ 线上还没有 /api/videos/import 接口（HTTP 404）。\n  先部署带该接口的版本：npm run deploy\n`,
      )
      process.exitCode = 1
      return results
    }
    if (res.status === 401) {
      console.error('\n✘ 线上拒绝了写操作（401）：ADMIN_TOKEN 不对或没读到。\n')
      process.exitCode = 1
      return results
    }
    if (res.status !== 200) {
      console.error(`\n✘ 上传失败：HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 200)}\n`)
      process.exitCode = 1
      return results
    }
    results.push(...(res.data.results || []))
    const okCount = (res.data.results || []).filter((r) => r.ok).length
    console.log(`  批次 ${Math.floor(i / BATCH) + 1}：${okCount}/${chunk.length} 成功`)
    for (const r of res.data.results || []) {
      if (!r.ok) console.error(`    ✘ ${r.bvid} → ${r.error}`)
    }
  }

  // 回读校验：线上必须真的变成完整记录，且分类保持原样
  const after = await loadLive()
  const afterById = new Map(after.items.map((v) => [v.bvid, v]))
  let verified = 0
  const problems = []
  for (const r of results.filter((x) => x.ok)) {
    const live = afterById.get(r.bvid)
    const original = beforeById.get(r.bvid)
    if (!live) {
      problems.push(`${r.bvid} 上传后线上找不到`)
      continue
    }
    if (live.metadataState !== 'complete' || !live.cover || !live.aid) {
      problems.push(`${r.bvid} 回读仍是 ${live.metadataState}（封面 ${live.cover ? '有' : '无'} / aid ${live.aid || '无'}）`)
      continue
    }
    if (!flag('with-collection') && original && live.collectionId !== original.collectionId) {
      problems.push(`${r.bvid} 的分类被改动了：${original.collectionId || '未分类'} → ${live.collectionId || '未分类'}`)
      continue
    }
    verified += 1
  }

  console.log(`\n上传完成：${results.filter((r) => r.ok).length}/${results.length} 成功，回读校验通过 ${verified} 条`)
  problems.forEach((p) => console.error(`  ✘ ${p}`))
  if (problems.length) process.exitCode = 1
  return results
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(`用法：npm run sync -- <list|hydrate|push|run> [选项]

  list      看线上有哪些视频、哪些缺元数据（默认命令）
  hydrate   用本机 IP 抓 B 站元数据，补齐本地记录
  push      把本地记录上传到线上（不经过 B 站）
  run       list → hydrate → push → 回读校验

选项：--base <url> --bvids A,B --all --dry --no-store --direct --local <url>
      --delay <ms> --limit <n> --with-collection --json`)
  process.exit(0)
}

if (!COMMANDS.includes(command)) {
  console.error(`未知命令：${command}（可用：${COMMANDS.join(' / ')}）`)
  process.exit(1)
}

async function main() {
  if (command === 'list') {
    await runList()
    return
  }

  if (command === 'hydrate') {
    await runList()
    console.log('')
    await runHydrate()
    return
  }

  if (command === 'push') {
    await runPush()
    return
  }

  // run：一条龙
  const sameInstance = BASE === LOCAL_BASE
  const { rows } = await runList()
  const need = rows.filter((r) => r.need)
  console.log('')
  if (!need.length && !ALL && !BVIDS.length) {
    console.log('线上元数据都齐了，无需补齐/上传。')
    return
  }
  const hydrated = await runHydrate()
  console.log('')
  if (sameInstance) {
    console.log(`目标实例就是本地服务（${BASE}）：补齐已经生效，跳过 push。`)
  } else if (localServer.driver === 'file') {
    await runPush(hydrated)
  } else {
    console.log('本地存储驱动是 KV：补齐已经直接写进线上库，跳过 push。')
  }
  console.log('')
  await runList()
}

try {
  await main()
} catch (err) {
  console.error(`\n✘ ${err.message}`)
  hintProxy(err)
  process.exitCode = 1
}
