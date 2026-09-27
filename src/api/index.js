/**
 * Front-end API client.
 *
 * All data comes from the Node server (`server/index.js`) which resolves and
 * stores metadata from the Bilibili web API. There is no account system and the
 * site is read-only: publishing happens in the admin page at /admin.
 */

const BASE = '/api'

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, options)
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (err) {
    throw new Error(`服务端返回了非 JSON 响应（HTTP ${res.status}）`)
  }
  if (!res.ok) {
    throw new Error(data?.error || `请求失败（HTTP ${res.status}）`)
  }
  return data
}

/** Bilibili CDN images are proxied through the server (host-whitelisted). */
export function imageUrl(url) {
  if (!url) return ''
  return `${BASE}/image?url=${encodeURIComponent(url)}`
}

export async function fetchHealth() {
  return request('/health')
}

/** First-level partitions currently present in the library. */
export async function fetchCategories() {
  const data = await request('/categories')
  return data.categories || []
}

/**
 * @param {{keywords?: string, category?: string, collection?: string,
 *          sort?: 'added'|'play'|'pubdate'}} params
 * @returns {Promise<{items: object[], total: number, categories?: string[],
 *                    collections?: object[]}>}
 */
export async function fetchVideos({
  keywords = '',
  category = '',
  collection = '',
  sort = 'added',
} = {}) {
  const params = new URLSearchParams()
  if (keywords) params.set('keywords', keywords)
  if (category && category !== '全部') params.set('category', category)
  if (collection) params.set('collection', collection)
  if (sort) params.set('sort', sort)
  return request(`/videos?${params.toString()}`)
}

/** Hand-curated 分类, with per-category video counts. */
export async function fetchCollections() {
  const data = await request('/collections')
  return data.items || []
}

/**
 * One page of a video's real Bilibili comments (read-only).
 * @param {{bvid: string, mode?: 'hot'|'time', next?: number}} params
 */
export async function fetchBilibiliComments({ bvid, mode = 'hot', next = 0 }) {
  return request(`/comments/${encodeURIComponent(bvid)}?mode=${mode}&next=${next}`)
}

/** Resolve a list of bvids, preserving the given order. */
export async function fetchVideosByIds(ids = []) {
  if (!ids.length) return { items: [], total: 0 }
  return request(`/videos?ids=${encodeURIComponent(ids.join(','))}`)
}

export async function fetchVideo(bvid) {
  const data = await request(`/videos/${encodeURIComponent(bvid)}`)
  return data.item
}

/**
 * Retry the metadata of a deferred 投稿 (a record that only stores the bvid).
 *
 * 投稿 never fails because of a B 站 风控/412: the record is saved immediately
 * and the cover / 简介 / UP 主 are fetched on a later visit. The server throttles
 * this endpoint, so calling it whenever a pending video is opened is fine.
 *
 * @returns {Promise<{ok: boolean, hydrated: boolean, throttled?: boolean,
 *                    pending?: boolean, error?: string, item?: object}>}
 */
export async function hydrateVideo(bvid) {
  return request(`/videos/${encodeURIComponent(bvid)}/hydrate`, { method: 'POST' })
}
