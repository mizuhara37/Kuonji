/**
 * Export the live library into the committed seed (server/seed.js).
 *
 * The seed ships with a deployment so a fresh instance (e.g. Vercel) already
 * has content; it is only used as a fallback when no stored library exists.
 *
 *   npm run seed:export            # reads server/data/*.json
 *   M37_DATA_DIR=/tmp/x npm run seed:export
 *   BASE=http://127.0.0.1:8787 npm run seed:export -- --from-api
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = process.env.M37_DATA_DIR || join(ROOT, 'server', 'data')
const fromApi = process.argv.includes('--from-api')
const BASE = process.env.BASE || 'http://127.0.0.1:8787'

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`跳过 ${path}：${err.message}`)
    return fallback
  }
}

let videos = []
let collections = []

if (fromApi) {
  videos = (await (await fetch(`${BASE}/api/videos`)).json()).items || []
  collections = (await (await fetch(`${BASE}/api/collections`)).json()).items || []
  console.log(`从 ${BASE} 读取：${videos.length} 个视频 / ${collections.length} 个分类`)
} else {
  videos = await readJson(join(DATA_DIR, 'videos.json'), [])
  collections = await readJson(join(DATA_DIR, 'collections.json'), [])
  console.log(`从 ${DATA_DIR} 读取：${videos.length} 个视频 / ${collections.length} 个分类`)
}

// keep the seed readable and free of runtime-only fields
const cleanVideos = videos.map(({ sources, customSources, ...rest }) => rest)
const cleanCollections = collections.map(({ count, ...rest }) => rest)

const banner = `/**
 * Committed seed library — GENERATED, do not edit by hand.
 *
 * Regenerate with \`npm run seed:export\` (reads server/data/*.json) or
 * \`npm run seed:export -- --from-api\` (reads a running server).
 *
 * Used only as a FALLBACK when no library has been stored yet, so a fresh
 * deployment (for example on Vercel, where the filesystem is read-only) still
 * starts with content. A stored library always wins.
 *
 * Generated: ${new Date().toISOString()}
 */

`

const body =
  `export const seedVideos = ${JSON.stringify(cleanVideos, null, 2)}\n\n` +
  `export const seedCollections = ${JSON.stringify(cleanCollections, null, 2)}\n`

const target = join(ROOT, 'server', 'seed.js')
await writeFile(target, banner + body, 'utf8')
console.log(`已写入 ${target}`)
