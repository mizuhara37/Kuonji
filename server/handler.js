/**
 * Request handler — shared by the standalone Node server (server/index.js) and
 * the Vercel serverless entry (api/index.js).
 *
 *   • serves the built SPA (dist/) with history fallback
 *   • serves the 投稿后台 (public/admin.html) at /admin
 *   • JSON API over the video library + hand-curated 分类
 *   • resolves metadata for a given bvid from the Bilibili web API
 *   • proxies Bilibili CDN images (whitelisted hosts)
 *
 * Writes are protected by ADMIN_TOKEN when that env var is set.
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { timingSafeEqual } from 'node:crypto'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BilibiliError,
  extractVideoId,
  fetchComments,
  fetchVideoMeta,
  isAllowedImageHost,
  isTransientError,
  normalizeFromView,
  parseInputList,
} from './bilibili.js'
import * as store from './store.js'
import { canWriteFiles, driver, describeLocation } from './backend.js'
import { publicConfig } from './config.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DIST = join(ROOT, 'dist')
const PUBLIC_DIR = join(ROOT, 'public')

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''
export const authRequired = Boolean(ADMIN_TOKEN)

/**
 * Short-lived in-memory cache for Bilibili comment pages, so a busy video page
 * doesn't hammer the upstream API (and to soften its rate limiting).
 */
const commentCache = new Map()
const COMMENT_TTL = 60 * 1000

/**
 * Throttle for the deferred-metadata retry (`POST /api/videos/:bvid/hydrate`).
 * Visitors trigger it while browsing, so the same bvid is only re-checked every
 * HYDRATE_INTERVAL, no matter how many tabs are open.
 */
const HYDRATE_INTERVAL = 20 * 1000
const hydrateAt = new Map()

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json; charset=utf-8',
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(text)
}

async function readJsonBody(req, limit = 256 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch (err) {
    return { input: text }
  }
}

async function serveFile(res, filePath, { cache = false } = {}) {
  const info = await stat(filePath)
  if (!info.isFile()) return false
  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': info.size,
    'Cache-Control': cache ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(filePath).pipe(res)
  return true
}

/** Resolve a URL path inside a directory (rejects traversal). */
function resolveIn(baseDir, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0])
  const target = normalize(join(baseDir, decoded))
  if (target !== baseDir && !target.startsWith(baseDir + sep)) return null
  return target
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** Writes are open without ADMIN_TOKEN (local use), otherwise token-gated. */
function isAuthorized(req, url) {
  if (!authRequired) return true
  const header = req.headers['x-admin-token'] || ''
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const query = url.searchParams.get('token') || ''
  return [header, bearer, query].some((candidate) => candidate && safeEqual(candidate, ADMIN_TOKEN))
}

function requireAuth(req, res, url) {
  if (isAuthorized(req, url)) return true
  sendJson(res, 401, { error: '需要管理口令（ADMIN_TOKEN）', authRequired: true })
  return false
}

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */

async function handleApi(req, res, url) {
  const segments = url.pathname.split('/').filter(Boolean) // ['api', ...]
  const [, resource, ...rest] = segments
  const method = req.method || 'GET'
  const isWrite = method === 'POST' || method === 'PATCH' || method === 'DELETE'

  // Reads always work; writes need (a) the admin token when configured and
  // (b) a writable store. On Vercel the filesystem is read-only, so without an
  // external KV the answer has to be an actionable message, not an EROFS dump.
  //
  // `hydrate` is the one exception: it is triggered by ordinary visitors when a
  // deferred 投稿 is opened, carries no user input, and is throttled below —
  // so it does not require the admin token.
  const isHydrate = resource === 'videos' && rest[1] === 'hydrate' && method === 'POST'

  if (isWrite) {
    if (!isHydrate && !requireAuth(req, res, url)) return
    if (!canWriteFiles() && driver !== 'kv') {
      return sendJson(res, 503, {
        error:
          '当前部署不可写：Vercel 的文件系统是只读的，请在项目里配置 KV_REST_API_URL / KV_REST_API_TOKEN（或 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN）后重新部署。',
        canWrite: false,
        storage: describeLocation(),
      })
    }
  }

  /* ---------------- meta ---------------- */

  if (resource === 'health') {
    return sendJson(res, 200, {
      ok: true,
      library: await store.count(),
      collections: (await store.listCollections()).length,
      storage: describeLocation(),
      driver,
      canWrite: canWriteFiles() || driver === 'kv',
      authRequired,
      hasBuild: await stat(join(DIST, 'index.html')).then(() => true).catch(() => false),
    })
  }

  /* ---------------- branding ---------------- */

  // Public: the SPA gets it at build time, the static /admin page at runtime.
  if (resource === 'config') {
    return sendJson(res, 200, { item: publicConfig() })
  }

  /* ---------------- image proxy ---------------- */

  if (resource === 'image') {
    const raw = url.searchParams.get('url')
    if (!raw) return sendText(res, 400, 'missing url')
    let target
    try {
      target = new URL(raw)
    } catch (err) {
      return sendText(res, 400, 'bad url')
    }
    if (target.protocol !== 'https:' || !isAllowedImageHost(target.hostname)) {
      return sendText(res, 403, 'host not allowed')
    }
    try {
      const upstream = await fetch(target.href, {
        headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0' },
      })
      if (!upstream.ok) return sendText(res, 502, `upstream ${upstream.status}`)
      const buffer = Buffer.from(await upstream.arrayBuffer())
      res.writeHead(200, {
        'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
        'Content-Length': buffer.length,
        'Cache-Control': 'public, max-age=86400',
      })
      return res.end(buffer)
    } catch (err) {
      return sendText(res, 502, `image fetch failed: ${err.message}`)
    }
  }

  /* ---------------- collections (分类) ---------------- */

  if (resource === 'collections') {
    const id = rest[0]

    if (method === 'GET') {
      return sendJson(res, 200, { items: await store.listCollections() })
    }

    if (isWrite && !requireAuth(req, res, url)) return

    if (method === 'POST' && !id) {
      const body = await readJsonBody(req)
      const result = await store.createCollection(body.name)
      if (!result.ok) return sendJson(res, 400, { error: result.reason })
      return sendJson(res, 200, { ok: true, item: result.collection })
    }

    if (method === 'POST' && id === 'reorder') {
      const body = await readJsonBody(req)
      await store.reorderCollections(Array.isArray(body.ids) ? body.ids : [])
      return sendJson(res, 200, { ok: true, items: await store.listCollections() })
    }

    if (method === 'PATCH' && id) {
      const body = await readJsonBody(req)
      const result = await store.renameCollection(id, body.name)
      if (!result.ok) return sendJson(res, 400, { error: result.reason })
      return sendJson(res, 200, { ok: true, item: result.collection })
    }

    if (method === 'DELETE' && id) {
      const removed = await store.deleteCollection(id)
      return sendJson(res, removed ? 200 : 404, removed ? { ok: true } : { error: '分类不存在' })
    }

    return sendJson(res, 405, { error: 'method not allowed' })
  }

  /* ---------------- categories (一级分区) ---------------- */

  if (resource === 'categories') {
    const all = await store.list()
    return sendJson(res, 200, {
      categories: [...new Set(all.map((v) => v.categoryParent).filter(Boolean))],
    })
  }

  /* ---------------- comments (B 站评论，只读) ---------------- */

  if (resource === 'comments') {
    const bvid = rest[0]
    if (method !== 'GET' || !bvid) return sendJson(res, 405, { error: 'method not allowed' })

    const mode = url.searchParams.get('mode') === 'time' ? 'time' : 'hot'
    const next = Number(url.searchParams.get('next')) || 0
    const key = `${bvid}:${mode}:${next}`

    const cached = commentCache.get(key)
    if (cached && cached.expires > Date.now()) {
      return sendJson(res, 200, { ...cached.data, cached: true })
    }

    const record = await store.get(bvid)
    if (!record) return sendJson(res, 404, { error: '视频不在库中' })

    let aid = record.aid
    if (!aid) {
      // a deferred 投稿 (or hand-written record) may have no aid yet — resolve it
      // once, which also fills in the cover / 简介 / UP 主
      try {
        const meta = await fetchVideoMeta(bvid)
        const saved = await store.applyMetadata(bvid, meta)
        aid = saved.aid
      } catch (err) {
        await store.markChecked(bvid, err.message)
        return sendJson(res, 502, { error: err.message })
      }
    }

    try {
      const data = await fetchComments({ aid, mode, next, upMid: record.owner.mid })
      commentCache.set(key, { expires: Date.now() + COMMENT_TTL, data })
      if (commentCache.size > 200) commentCache.clear()
      return sendJson(res, 200, { ...data, aid, bvid })
    } catch (err) {
      return sendJson(res, 502, {
        error: err instanceof BilibiliError ? err.message : String(err.message || err),
      })
    }
  }

  /* ---------------- videos ---------------- */

  if (resource !== 'videos') return sendJson(res, 404, { error: 'unknown endpoint' })

  const bvid = rest[0]
  const action = rest[1]

  if (method === 'GET' && !bvid) {
    const keywords = (url.searchParams.get('keywords') || '').trim().toLowerCase()
    const category = url.searchParams.get('category') || ''
    const collection = url.searchParams.get('collection') || ''
    const sort = url.searchParams.get('sort') || 'added'
    const ids = (url.searchParams.get('ids') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const all = await store.list()
    const collections = await store.listCollections()
    const collectionNames = new Map(collections.map((c) => [c.id, c.name]))
    // expose the curated 分类 name so cards don't need a second lookup
    const decorate = (v) => ({
      ...v,
      collectionName: v.collectionId ? collectionNames.get(v.collectionId) || '' : '',
    })

    let items = all

    if (ids.length) {
      const wanted = ids.map((id) => id.toLowerCase())
      items = items
        .filter((v) => wanted.includes(v.bvid.toLowerCase()))
        .sort((a, b) => wanted.indexOf(a.bvid.toLowerCase()) - wanted.indexOf(b.bvid.toLowerCase()))
      return sendJson(res, 200, { items: items.map(decorate), total: items.length })
    }

    if (collection) {
      items =
        collection === 'uncategorized'
          ? items.filter((v) => !v.collectionId)
          : items.filter((v) => v.collectionId === collection)
    }
    if (category && category !== '全部') {
      items = items.filter((v) => v.category === category || v.categoryParent === category)
    }
    if (keywords) {
      items = items.filter((v) =>
        `${v.title} ${v.desc} ${v.owner.name} ${v.category} ${v.tags.join(' ')}`
          .toLowerCase()
          .includes(keywords),
      )
    }
    if (sort === 'play') items = [...items].sort((a, b) => b.stat.view - a.stat.view)
    else if (sort === 'pubdate') items = [...items].sort((a, b) => b.pubdate - a.pubdate)

    return sendJson(res, 200, {
      items: items.map(decorate),
      total: items.length,
      categories: [...new Set(all.map((v) => v.categoryParent).filter(Boolean))],
      collections,
    })
  }

  // POST /api/videos/import — 写入「已经在别处抓好的」完整元数据，服务端完全不碰 B 站。
  // 两种来源：
  //   { records: [...] }                  已经归一化的记录（`npm run sync` 用它）
  //   { views: [{ view, tags }, ...] }    浏览器（访客自己的 IP）JSONP 抓到的**原始 B 站响应**，
  //                                       归一化交给服务端，保证 tid→分区等逻辑只有一份
  // 只接受白名单字段，分类默认沿用线上已有的。
  if (method === 'POST' && bvid === 'import') {
    const body = await readJsonBody(req, 4 * 1024 * 1024)
    const records = Array.isArray(body.records) ? body.records : []
    const views = Array.isArray(body.views) ? body.views : []
    if (!records.length && !views.length) {
      return sendJson(res, 400, { error: 'records / views 不能为空' })
    }

    const IMPORTABLE = [
      'bvid',
      'aid',
      'cid',
      'title',
      'desc',
      'cover',
      'duration',
      'pubdate',
      'category',
      'categoryParent',
      'tags',
      'owner',
      'stat',
      'pages',
      'metadataSource',
    ]

    const results = []

    // 浏览器抓来的原始 payload：服务端归一化（分区映射、封面、分 P…）
    for (const entry of views) {
      const view = entry?.view || entry?.data?.View || entry?.data || null
      const tags = entry?.tags || entry?.data?.Tags || null
      if (!view?.bvid) {
        results.push({ bvid: String(entry?.bvid || ''), ok: false, error: '缺少合法的 view 数据' })
        continue
      }
      try {
        const meta = normalizeFromView(view, { tags, source: 'browser' })
        const before = await store.get(meta.bvid)
        const record = await store.applyMetadata(meta.bvid, meta)
        results.push({ bvid: meta.bvid, ok: true, created: !before, item: record })
      } catch (err) {
        results.push({ bvid: String(view.bvid), ok: false, error: String(err.message || err) })
      }
    }

    for (const raw of records) {
      const incoming = raw && typeof raw === 'object' ? raw : {}
      const target = extractVideoId(incoming.bvid || '')
      const title = String(incoming.title || '').trim()
      if (!target?.bvid || target.bvid !== String(incoming.bvid || '').trim()) {
        results.push({ bvid: String(incoming.bvid || ''), ok: false, error: '缺少合法的 bvid' })
        continue
      }
      // An import is by definition "complete" metadata — refuse to mark a
      // placeholder as complete, that would show an empty card on the site.
      if (!title || title === target.bvid) {
        results.push({ bvid: target.bvid, ok: false, error: '缺少标题（请先在本地补齐元数据）' })
        continue
      }

      const picked = { bvid: target.bvid }
      for (const key of IMPORTABLE) {
        if (incoming[key] !== undefined) picked[key] = incoming[key]
      }
      // 分类是线上后台的策展结果，默认不动（store.upsert 也会保留已有值）
      if (body.withCollection && incoming.collectionId !== undefined) {
        picked.collectionId = String(incoming.collectionId || '')
      }

      try {
        const before = await store.get(target.bvid)
        const record = await store.applyMetadata(target.bvid, picked)
        results.push({ bvid: target.bvid, ok: true, created: !before, item: record })
      } catch (err) {
        results.push({ bvid: target.bvid, ok: false, error: String(err.message || err) })
      }
    }

    const ok = results.filter((r) => r.ok).length
    return sendJson(res, ok ? 200 : 400, {
      ok: ok > 0,
      imported: ok,
      created: results.filter((r) => r.ok && r.created).length,
      updated: results.filter((r) => r.ok && !r.created).length,
      failed: results.length - ok,
      results,
    })
  }

  if (method === 'GET' && bvid && !action) {
    const record = await store.get(bvid)
    if (!record) return sendJson(res, 404, { error: '视频不在库中' })
    const collections = await store.listCollections()
    return sendJson(res, 200, {
      item: {
        ...record,
        collectionName: record.collectionId
          ? collections.find((c) => c.id === record.collectionId)?.name || ''
          : '',
      },
    })
  }

  // `hydrate` (the visitor-triggered metadata retry) is the only write that does
  // not require the admin token — see the guard above.
  if (isWrite && !isHydrate && !requireAuth(req, res, url)) return

  // POST /api/videos        { input, deferMetadata? }
  if (method === 'POST' && !bvid) {
    const body = await readJsonBody(req)
    const inputs = parseInputList(body.input ?? body.bvid ?? '')
    if (!inputs.length) return sendJson(res, 400, { error: '请输入 bvid 或视频链接' })

    // 「只存链接」: never touch Bilibili, just record the bvid and let a later
    // visit fill in the metadata.
    const deferMetadata = body.deferMetadata === true

    const results = []
    for (const input of inputs) {
      try {
        if (results.length) await new Promise((r) => setTimeout(r, 350))
        const id = extractVideoId(input)
        if (!id) {
          throw new BilibiliError('无法识别视频 ID，请输入 BV 号或视频链接', 'BAD_INPUT')
        }
        if (!id.bvid) {
          // an av number has no stable id of its own — it needs one successful
          // lookup before it can be stored
          throw new BilibiliError(
            'av 号需要成功抓取一次元数据才能收录（请改用 BV 号或稍后重试）',
            'AV_NEEDS_META',
          )
        }

        let meta = null
        if (!deferMetadata) {
          try {
            meta = await fetchVideoMeta(id.bvid)
          } catch (err) {
            // A banned / rate-limited IP must not lose the 投稿: keep the bvid
            // and retry on a later visit. Only real "this video is gone" errors
            // are reported as failures.
            if (!isTransientError(err)) throw err
            const previous = await store.get(id.bvid)
            const placeholder =
              store.makePlaceholder({ bvid: id.bvid, error: err.message }) || null
            const { record, created } = await store.upsert({
              ...(previous || placeholder),
              bvid: id.bvid,
              metadataState: previous?.metadataState === 'complete' ? 'complete' : 'pending',
              metadataError: err.message,
              metadataCheckedAt: Date.now(),
            })
            results.push({
              input,
              ok: true,
              created,
              deferred: true,
              pending: record.metadataState === 'pending',
              warning: err.message,
              item: record,
            })
            continue
          }
        }

        if (meta) {
          const previous = await store.get(id.bvid)
          const record = previous
            ? await store.applyMetadata(id.bvid, meta)
            : (await store.upsert(meta)).record
          results.push({ input, ok: true, created: !previous, item: record })
        } else {
          const previous = await store.get(id.bvid)
          const { record, created } = await store.upsert({
            ...(previous || store.makePlaceholder({ bvid: id.bvid })),
            bvid: id.bvid,
            metadataState: previous?.metadataState === 'complete' ? 'complete' : 'pending',
            metadataCheckedAt: Date.now(),
          })
          results.push({
            input,
            ok: true,
            created,
            deferred: true,
            // an existing complete record is never downgraded
            pending: record.metadataState === 'pending',
            item: record,
          })
        }
      } catch (err) {
        results.push({
          input,
          ok: false,
          error: err instanceof BilibiliError ? err.message : String(err.message || err),
        })
      }
    }

    const added = results.filter((r) => r.ok && r.created).length
    const refreshed = results.filter((r) => r.ok && !r.created).length
    const deferred = results.filter((r) => r.deferred).length
    const failed = results.filter((r) => !r.ok).length
    return sendJson(res, failed && !added && !refreshed ? 400 : 200, {
      results,
      added,
      refreshed,
      deferred,
      failed,
    })
  }

  // POST /api/videos/:bvid/hydrate — retry a deferred 投稿's metadata.
  // Triggered automatically when a visitor opens a pending video.
  if (method === 'POST' && bvid && action === 'hydrate') {
    const existing = await store.get(bvid)
    if (!existing) return sendJson(res, 404, { error: '视频不在库中' })

    const last = hydrateAt.get(bvid) || 0
    if (Date.now() - last < HYDRATE_INTERVAL) {
      return sendJson(res, 200, {
        ok: false,
        hydrated: false,
        throttled: true,
        pending: existing.metadataState === 'pending',
        error: '刚刚已经尝试过，请稍后再试',
        item: existing,
      })
    }
    hydrateAt.set(bvid, Date.now())
    if (hydrateAt.size > 500) hydrateAt.clear()

    try {
      const meta = await fetchVideoMeta(bvid)
      const record = await store.applyMetadata(bvid, meta)
      return sendJson(res, 200, { ok: true, hydrated: true, item: record })
    } catch (err) {
      // stay quiet for visitors: 200 + pending so the UI shows a hint instead of
      // an error, and the next visit tries again
      await store.markChecked(bvid, err.message)
      return sendJson(res, 200, {
        ok: false,
        hydrated: false,
        pending: true,
        error: err instanceof BilibiliError ? err.message : String(err.message || err),
        item: await store.get(bvid),
      })
    }
  }

  // POST /api/videos/:bvid/refresh
  if (method === 'POST' && bvid && action === 'refresh') {
    try {
      const meta = await fetchVideoMeta(bvid)
      // refreshing metadata must not silently drop the curation
      const record = await store.applyMetadata(bvid, meta)
      return sendJson(res, 200, { ok: true, item: record })
    } catch (err) {
      const record = await store.markChecked(bvid, err.message)
      return sendJson(res, 400, { error: err.message, item: record })
    }
  }

  // PATCH /api/videos/:bvid   { collectionId }
  if (method === 'PATCH' && bvid && !action) {
    const body = await readJsonBody(req)
    const ok = await store.assignCollection(bvid, body.collectionId)
    if (!ok) return sendJson(res, 400, { error: '视频或分类不存在' })
    return sendJson(res, 200, { ok: true, item: await store.get(bvid) })
  }

  // DELETE /api/videos/:bvid
  if (method === 'DELETE' && bvid) {
    const removed = await store.remove(bvid)
    return sendJson(res, removed ? 200 : 404, removed ? { ok: true } : { error: '视频不在库中' })
  }

  return sendJson(res, 405, { error: 'method not allowed' })
}

/* ------------------------------------------------------------------ *
 * static + routing
 * ------------------------------------------------------------------ */

export async function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url)
      return
    }

    // admin page (built into dist/ from public/admin.html)
    if (url.pathname === '/admin' || url.pathname === '/admin/' || url.pathname === '/admin.html') {
      const fromDist = await serveFile(res, join(DIST, 'admin.html')).catch(() => false)
      if (fromDist) return
      const fromPublic = await serveFile(res, join(PUBLIC_DIR, 'admin.html')).catch(() => false)
      if (fromPublic) return
      return sendText(res, 404, 'admin.html 不存在')
    }

    const distPath = resolveIn(DIST, url.pathname)
    if (distPath && url.pathname !== '/') {
      const served = await serveFile(res, distPath, {
        cache: url.pathname.startsWith('/assets/'),
      }).catch(() => false)
      if (served) return
    }

    const ok = await serveFile(res, join(DIST, 'index.html')).catch(() => false)
    if (ok) return

    sendText(
      res,
      503,
      '前端尚未构建。请先运行 `npm run build`，或使用 `npm run dev` 配合 Vite 开发服务器。',
    )
  } catch (err) {
    console.error('[server]', err)
    if (!res.headersSent) sendJson(res, 500, { error: err.message })
  }
}
