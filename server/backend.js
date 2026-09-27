/**
 * Persistence backend.
 *
 * Two drivers, chosen by environment:
 *
 *   file  (default)      — JSON files under server/data/. Used locally.
 *   upstash / vercel-kv  — Upstash Redis REST API. Required on serverless hosts
 *                          (Vercel), where the filesystem is read-only and
 *                          per-invocation /tmp is not shared between requests.
 *
 * Recognised env vars for the KV driver:
 *   KV_REST_API_URL / KV_REST_API_TOKEN            (Vercel KV integration)
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *
 * The documents are small (a few KB per video), so each one is stored as a
 * single JSON string under a namespaced key.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** Overridable so tests / multiple instances can use separate libraries. */
export const DATA_DIR = process.env.M37_DATA_DIR
  ? resolve(process.env.M37_DATA_DIR)
  : join(HERE, 'data')

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || ''
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''

export const driver = KV_URL && KV_TOKEN ? 'kv' : 'file'
export const driverLabel = driver === 'kv' ? 'Upstash Redis / Vercel KV' : `JSON 文件 (${DATA_DIR})`

/** True when the host gives us a writable, persistent filesystem. */
export function canWriteFiles() {
  return driver === 'file' && !process.env.VERCEL
}

function filePathFor(key) {
  return join(DATA_DIR, `${key}.json`)
}

async function readFileDoc(key) {
  try {
    return JSON.parse(await readFile(filePathFor(key), 'utf8'))
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[store] 无法读取 ${filePathFor(key)}：${err.message}`)
    }
    return null
  }
}

async function writeFileDoc(key, value) {
  await mkdir(DATA_DIR, { recursive: true })
  const target = filePathFor(key)
  const tmp = `${target}.tmp`
  // atomic: a crash mid-write can never truncate the library
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await rename(tmp, target)
}

async function kvCommand(command) {
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  })
  if (!res.ok) throw new Error(`KV ${res.status}: ${await res.text()}`)
  const data = await res.json()
  if (data.error) throw new Error(`KV error: ${data.error}`)
  return data.result
}

async function readKvDoc(key) {
  const raw = await kvCommand(['GET', `m37:${key}`])
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (err) {
    console.warn(`[store] KV 中的 ${key} 不是合法 JSON，已忽略`)
    return null
  }
}

async function writeKvDoc(key, value) {
  await kvCommand(['SET', `m37:${key}`, JSON.stringify(value)])
}

/** Read one document (videos / collections). Returns null when absent. */
export async function readDoc(key) {
  return driver === 'kv' ? readKvDoc(key) : readFileDoc(key)
}

/** Write one document. */
export async function writeDoc(key, value) {
  return driver === 'kv' ? writeKvDoc(key, value) : writeFileDoc(key, value)
}

/** Human-readable location, shown by /api/health and the admin footer. */
export function describeLocation() {
  return driverLabel
}
