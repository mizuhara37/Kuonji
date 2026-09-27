/**
 * Upstash Redis / Vercel KV operations tool.
 *
 *   KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/kv-tool.mjs ping
 *   ... node scripts/kv-tool.mjs dump
 *   ... node scripts/kv-tool.mjs seed [--dry]     # from server/data/*.json
 *   ... node scripts/kv-tool.mjs clear
 *
 * `seed` mirrors the local JSON library into KV using exactly the keys and
 * payload shape the server writes (`m37:videos`, `m37:collections`), and
 * verifies the round trip. Useful for the first deployment, for migrating a
 * local library to a hosted instance, or for inspecting what is online.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = process.env.M37_DATA_DIR || join(ROOT, 'server', 'data')
const URL_BASE = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '')
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''
const READONLY = process.env.KV_REST_API_READ_ONLY_TOKEN || ''

const KEYS = { videos: 'm37:videos', collections: 'm37:collections' }

if (!URL_BASE || !TOKEN) {
  console.error('缺少 KV_REST_API_URL / KV_REST_API_TOKEN 环境变量')
  process.exit(1)
}

async function command(args, { token = TOKEN } = {}) {
  const res = await fetch(URL_BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch (err) {
    throw new Error(`KV 返回了非 JSON 响应（HTTP ${res.status}）：${text.slice(0, 120)}`)
  }
  if (!res.ok || data.error) {
    throw new Error(`KV 命令失败：${data.error || `HTTP ${res.status}`}`)
  }
  return data.result
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`跳过 ${path}：${err.message}`)
    return fallback
  }
}

const command_ = process.argv[2] || 'ping'
const dryRun = process.argv.includes('--dry')

if (command_ === 'ping') {
  const pong = await command(['PING'])
  console.log(`PING → ${pong}`)
  const keys = await command(['KEYS', 'm37:*'])
  console.log(`已有键：${Array.isArray(keys) && keys.length ? keys.join(', ') : '（空）'}`)
  if (READONLY) {
    const ro = await command(['PING'], { token: READONLY })
    console.log(`只读令牌 PING → ${ro}`)
  }
}

if (command_ === 'dump') {
  for (const [name, key] of Object.entries(KEYS)) {
    const raw = await command(['GET', key])
    if (!raw) {
      console.log(`${name}: （未设置）`)
      continue
    }
    const parsed = JSON.parse(raw)
    console.log(`${name}: ${Array.isArray(parsed) ? `${parsed.length} 条` : typeof parsed}  ${raw.length} 字节`)
    if (Array.isArray(parsed)) {
      parsed.slice(0, 3).forEach((v) => console.log(`   - ${v.bvid || v.id} ${v.title || v.name || ''}`))
      if (parsed.length > 3) console.log(`   … 其余 ${parsed.length - 3} 条`)
    }
  }
}

if (command_ === 'seed') {
  const videos = await readJson(join(DATA_DIR, 'videos.json'), [])
  const collections = await readJson(join(DATA_DIR, 'collections.json'), [])
  // match what server/backend.js writes
  const payloads = {
    videos: JSON.stringify(videos.map(({ sources, customSources, ...rest }) => rest)),
    collections: JSON.stringify(collections.map(({ count, ...rest }) => rest)),
  }
  console.log(`来源 ${DATA_DIR}`)
  console.log(`  视频 ${videos.length} 条 / ${payloads.videos.length} 字节`)
  console.log(`  分类 ${collections.length} 条 / ${payloads.collections.length} 字节`)

  if (dryRun) {
    console.log('--dry：未写入')
  } else {
    for (const [name, key] of Object.entries(KEYS)) {
      await command(['SET', key, payloads[name]])
      const back = await command(['GET', key])
      const ok = back === payloads[name]
      console.log(`  ${ok ? '✔' : '✘'} ${key} 写入${ok ? '并校验通过' : '校验失败'}`)
      if (!ok) process.exitCode = 1
    }
    console.log('完成：线上库现在与本地一致')
  }
}

if (command_ === 'clear') {
  for (const key of Object.values(KEYS)) {
    await command(['DEL', key])
    console.log(`已删除 ${key}`)
  }
  console.log('注意：清空后线上会退回 server/seed.js 的内容（只读部署仍可浏览）')
}
