/**
 * Library store.
 *
 * Two documents:
 *   videos      — normalized video records (see server/bilibili.js)
 *   collections — hand-curated 分类 used to organise the home page
 *
 * Records are normalized on read, so a hand-edited / partially filled entry
 * (the library file is meant to be editable) can never crash the UI.
 *
 * Persistence is delegated to server/backend.js (JSON files locally, Upstash
 * Redis / Vercel KV when those env vars are present).
 */
import { describeLocation, readDoc, writeDoc } from './backend.js'
import { seedCollections, seedVideos } from './seed.js'

const VIDEOS = 'videos'
const COLLECTIONS = 'collections'

const cache = { videos: null, collections: null, loaded: false }
let writing = Promise.resolve()

function num(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeStat(stat) {
  const s = stat && typeof stat === 'object' ? stat : {}
  return {
    view: num(s.view),
    danmaku: num(s.danmaku),
    reply: num(s.reply),
    like: num(s.like),
    coin: num(s.coin),
    favorite: num(s.favorite),
    share: num(s.share),
  }
}

/**
 * A record is `complete` once real metadata was fetched, and `pending` while it
 * only holds a bvid (e.g. Bilibili banned the datacentre IP during 投稿). The
 * state is never downgraded — a failed refresh keeps whatever we already have.
 */
function inferMetadataState(raw) {
  if (raw.metadataState === 'pending' || raw.metadataState === 'complete') {
    return raw.metadataState
  }
  const hasMeta =
    num(raw.aid) > 0 ||
    Boolean(String(raw.cover || '')) ||
    Boolean(raw.title && String(raw.title) !== String(raw.bvid))
  return hasMeta ? 'complete' : 'pending'
}

/** Fill in anything a hand-written record might be missing. */
function normalizeVideo(raw, fallbackIndex = 0) {
  if (!raw || typeof raw !== 'object' || !raw.bvid) return null
  const owner = raw.owner && typeof raw.owner === 'object' ? raw.owner : {}
  const duration = num(raw.duration)
  const pages =
    Array.isArray(raw.pages) && raw.pages.length
      ? raw.pages.map((p, i) => ({
          page: num(p?.page, i + 1),
          part: String(p?.part || raw.title || `P${i + 1}`),
          duration: num(p?.duration),
          cid: num(p?.cid),
        }))
      : [
          {
            page: 1,
            part: String(raw.title || raw.bvid),
            duration,
            cid: num(raw.cid),
          },
        ]

  return {
    ...raw,
    bvid: String(raw.bvid),
    aid: num(raw.aid),
    cid: num(raw.cid),
    title: String(raw.title || raw.bvid),
    desc: String(raw.desc || ''),
    cover: String(raw.cover || ''),
    duration,
    pubdate: num(raw.pubdate),
    category: String(raw.category || '未分区'),
    categoryParent: String(raw.categoryParent || raw.category || '未分区'),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String).filter(Boolean) : [],
    owner: {
      mid: num(owner.mid),
      name: String(owner.name || '未知 UP 主'),
      face: String(owner.face || ''),
    },
    stat: normalizeStat(raw.stat),
    pages,
    partCount: pages.length,
    metadataState: inferMetadataState(raw),
    metadataError: String(raw.metadataError || ''),
    metadataCheckedAt: num(raw.metadataCheckedAt),
    collectionId: raw.collectionId ? String(raw.collectionId) : '',
    addedAt: num(raw.addedAt) || num(raw.pubdate) * 1000 || Date.now() - fallbackIndex,
  }
}

/** True when the entry still waits for Bilibili metadata. */
export function isPending(record) {
  return !record || record.metadataState === 'pending'
}

/**
 * A library entry that stores only the bvid.
 *
 * 投稿 must never fail just because Bilibili banned the current IP, so the
 * record is created immediately and the metadata (cover, 简介, UP 主…) is
 * filled in later — on the next visit (`POST /api/videos/:bvid/hydrate`) or
 * from the admin page.
 */
export function makePlaceholder({ bvid, aid = 0, error = '' }) {
  return normalizeVideo({
    bvid,
    aid,
    title: bvid,
    metadataState: 'pending',
    metadataError: String(error || ''),
    metadataCheckedAt: Date.now(),
  })
}

function normalizeCollection(raw, index) {
  if (!raw || typeof raw !== 'object') return null
  const id = String(raw.id || '').trim()
  const name = String(raw.name || '').trim()
  if (!id || !name) return null
  return { id, name, order: num(raw.order, index) }
}

async function load() {
  if (cache.loaded) return cache
  const [videosDoc, collectionsDoc] = await Promise.all([
    readDoc(VIDEOS),
    readDoc(COLLECTIONS),
  ])

  // The committed seed (server/seed.js) is only a FALLBACK: a stored library
  // always wins — including an empty one, so deleting every video sticks.
  const videosSource = Array.isArray(videosDoc) ? videosDoc : seedVideos
  const collectionsSource = Array.isArray(collectionsDoc) ? collectionsDoc : seedCollections

  cache.videos = (Array.isArray(videosSource) ? videosSource : [])
    .map((v, i) => normalizeVideo(v, i))
    .filter(Boolean)
  cache.collections = (Array.isArray(collectionsSource) ? collectionsSource : [])
    .map(normalizeCollection)
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
  cache.loaded = true
  return cache
}

function flush(key) {
  const payload = cache[key]
  writing = writing.then(() => writeDoc(key, payload)).catch((err) => {
    console.error(`[store] 写入 ${key} 失败：${err.message}`)
    throw err
  })
  return writing
}

/* ------------------------------------------------------------------ *
 * videos
 * ------------------------------------------------------------------ */

export async function list() {
  const { videos } = await load()
  return [...videos].sort((a, b) => b.addedAt - a.addedAt)
}

export async function get(bvid) {
  const { videos } = await load()
  return videos.find((v) => v.bvid === bvid) || null
}

export async function upsert(record) {
  const { videos } = await load()
  const normalized = normalizeVideo(record)
  if (!normalized) throw new Error('无效的视频记录')

  const index = videos.findIndex((v) => v.bvid === normalized.bvid)
  if (index === -1) {
    const stored = { ...normalized, addedAt: Date.now() }
    videos.push(stored)
    await flush(VIDEOS)
    return { record: stored, created: true }
  }

  const previous = videos[index]
  // keep the original addedAt so the library order stays stable on refresh,
  // keep the curation when the incoming record does not carry one, and never
  // downgrade fetched metadata back to `pending`
  const stored = {
    ...previous,
    ...normalized,
    addedAt: previous.addedAt,
    collectionId: normalized.collectionId || previous.collectionId || '',
    metadataState: normalized.metadataState === 'complete' ? 'complete' : previous.metadataState,
  }
  videos[index] = stored
  await flush(VIDEOS)
  return { record: stored, created: false }
}

/**
 * Merge freshly fetched Bilibili metadata into a record. Used both by 「刷新元数据」
 * and by the automatic retry that fills in deferred entries.
 */
export async function applyMetadata(bvid, meta) {
  const existing = await get(bvid)
  const { record } = await upsert({
    ...(existing || {}),
    ...meta,
    bvid: String(bvid),
    metadataState: 'complete',
    metadataError: '',
    metadataCheckedAt: Date.now(),
  })
  return record
}

/**
 * Remember a failed metadata attempt: the entry stays `pending` and will be
 * retried on a later visit, but we record why (shown in the admin page).
 */
export async function markChecked(bvid, error = '') {
  const { videos } = await load()
  const video = videos.find((v) => v.bvid === bvid)
  if (!video) return null
  if (video.metadataState !== 'complete') video.metadataState = 'pending'
  video.metadataError = String(error || '')
  video.metadataCheckedAt = Date.now()
  await flush(VIDEOS)
  return video
}

export async function remove(bvid) {
  const { videos } = await load()
  const index = videos.findIndex((v) => v.bvid === bvid)
  if (index === -1) return false
  videos.splice(index, 1)
  await flush(VIDEOS)
  return true
}

export async function assignCollection(bvid, collectionId) {
  const { videos, collections } = await load()
  const video = videos.find((v) => v.bvid === bvid)
  if (!video) return false
  const target = String(collectionId || '')
  if (target && !collections.some((c) => c.id === target)) return false
  video.collectionId = target
  await flush(VIDEOS)
  return true
}

export async function count() {
  const { videos } = await load()
  return videos.length
}

/* ------------------------------------------------------------------ *
 * collections (hand-curated 分类)
 * ------------------------------------------------------------------ */

export async function listCollections() {
  const { videos, collections } = await load()
  return collections.map((c) => ({
    ...c,
    count: videos.filter((v) => v.collectionId === c.id).length,
  }))
}

export async function getCollection(id) {
  const { collections } = await load()
  return collections.find((c) => c.id === id) || null
}

function makeId(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const suffix = Math.random().toString(36).slice(2, 6)
  return slug ? `${slug}-${suffix}` : `col-${Date.now().toString(36)}-${suffix}`
}

export async function createCollection(name) {
  const trimmed = String(name || '').trim()
  if (!trimmed) return { ok: false, reason: '分类名不能为空' }
  if (trimmed.includes(':')) return { ok: false, reason: "由于系统设计，不能输入 ':' 字符" }

  const { collections } = await load()
  if (collections.some((c) => c.name === trimmed)) {
    return { ok: false, reason: '该分类已存在' }
  }

  const collection = { id: makeId(trimmed), name: trimmed, order: collections.length }
  collections.push(collection)
  await flush(COLLECTIONS)
  return { ok: true, collection: { ...collection, count: 0 } }
}

export async function renameCollection(id, name) {
  const trimmed = String(name || '').trim()
  if (!trimmed) return { ok: false, reason: '分类名不能为空' }
  const { collections } = await load()
  const target = collections.find((c) => c.id === id)
  if (!target) return { ok: false, reason: '分类不存在' }
  if (collections.some((c) => c.id !== id && c.name === trimmed)) {
    return { ok: false, reason: '该分类已存在' }
  }
  target.name = trimmed
  await flush(COLLECTIONS)
  return { ok: true, collection: target }
}

export async function deleteCollection(id) {
  const { videos, collections } = await load()
  const index = collections.findIndex((c) => c.id === id)
  if (index === -1) return false
  collections.splice(index, 1)
  collections.forEach((c, i) => {
    c.order = i
  })
  // keep the videos, just move them back to 未分类
  let touched = false
  videos.forEach((v) => {
    if (v.collectionId === id) {
      v.collectionId = ''
      touched = true
    }
  })
  await flush(COLLECTIONS)
  if (touched) await flush(VIDEOS)
  return true
}

export async function reorderCollections(ids) {
  const { collections } = await load()
  const order = new Map(ids.map((id, index) => [String(id), index]))
  collections.sort(
    (a, b) => (order.get(a.id) ?? a.order) - (order.get(b.id) ?? b.order),
  )
  collections.forEach((c, i) => {
    c.order = i
  })
  await flush(COLLECTIONS)
  return true
}

export function describeStorage() {
  return describeLocation()
}
