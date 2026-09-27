/**
 * Minimal Bilibili API client.
 *
 * Uses the public web-interface endpoints (no login, no keys):
 *   GET /x/web-interface/view/detail?bvid=BV...   -> View + Tags + Related
 *   GET /x/web-interface/view?aid=...             -> View (fallback for av ids)
 *
 * Only metadata is read; playback happens through the official embed player on
 * the front-end, so no stream URLs are ever scraped.
 */

import { randomUUID } from 'node:crypto'

const API_BASE = 'https://api.bilibili.com'

/**
 * Bilibili bans datacentre IP ranges (Vercel, and most cloud hosts) from the
 * `/x/web-interface/*` endpoints with `412 request was banned`. That was
 * measured from the deployment itself with eight different header sets — every
 * one was banned, while `/x/v2/reply/*` (comments) answers 200. So headers do
 * not decide this; keep them minimal and realistic, and rely on retries plus a
 * clear error message. See README › 在线上投稿的限制.
 */
const BUVID = `${randomUUID().toUpperCase()}infoc`

function buildHeaders() {
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Referer: 'https://www.bilibili.com/',
    Cookie: `buvid3=${BUVID}; b_nut=${Math.floor(Date.now() / 1000)}`,
  }
}

/** Bilibili's WAF answers datacentre IPs with 412 on the api endpoints. */
const RETRYABLE = new Set([412, 429, 500, 502, 503, 504])
/** Errors that mean "try again later" (store the bvid and retry on next visit). */
const TRANSIENT_CODES = new Set(['412', '429', 'TIMEOUT', 'NETWORK', 'HTML_PARSE', '-412', '-509', '-799'])

const HTTP_MESSAGES = {
  412:
    'B 站拒绝了这次请求（412 request was banned）。云主机（Vercel 等）的出口 IP 常被 B 站限制，' +
    '可稍后重试；更可靠的做法是在本地运行后台并让它直连线上 KV（见 README › 在线上投稿的限制）。',
  429: '请求过于频繁，请稍后再试',
  403: '访问被拒绝（可能是番剧、付费或仅限登录的内容）',
  404: '视频不存在或已被删除',
}

const TIMEOUT_MS = 15000
const MAX_RETRIES = 2

function httpMessage(status) {
  return HTTP_MESSAGES[status] || `B 站接口返回 HTTP ${status}`
}

/** True when the failure may pass later (so the record is worth keeping). */
export function isTransientError(err) {
  if (!err) return false
  if (err.transient !== undefined) return err.transient
  return TRANSIENT_CODES.has(String(err.code))
}

function markTransient(err) {
  if (err && err.transient === undefined) err.transient = isTransientError(err)
  return err
}

export class BilibiliError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'BilibiliError'
    this.code = code
  }
}

/** Human-readable reasons for the codes the web API commonly returns. */
const ERROR_MESSAGES = {
  '-400': '请求参数错误，请检查 bvid 是否正确',
  '-403': '访问被拒绝（可能是番剧、付费或仅限登录的内容）',
  '-404': '视频不存在或已被删除',
  '-412': '请求被 B 站风控拦截，请稍后再试',
  '-509': '请求过于频繁，请稍后再试',
  62002: '稿件不可见',
  62004: '稿件审核中',
}

/**
 * Accepts a bare BV id, an av number, or any bilibili.com video URL.
 * @returns {{ bvid?: string, aid?: number } | null}
 */
export function extractVideoId(input) {
  const text = String(input || '').trim()
  if (!text) return null

  const bv = text.match(/BV[0-9A-Za-z]{10}/)
  if (bv) return { bvid: bv[0] }

  const av = text.match(/(?:^|[^0-9a-zA-Z])av(\d{1,12})/i)
  if (av) return { aid: Number(av[1]) }

  return null
}

/** Split a textarea value into individual inputs (one per line/comma/space). */
export function parseInputList(text) {
  return [
    ...new Set(
      String(text || '')
        .split(/[\s,，;；]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ]
}

async function fetchOnce(url, headers) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers, signal: controller.signal })
    if (!res.ok) {
      const err = new BilibiliError(httpMessage(res.status), res.status)
      err.retryable = RETRYABLE.has(res.status)
      throw err
    }
    return res
  } catch (err) {
    if (err instanceof BilibiliError) throw err
    if (err.name === 'AbortError') {
      const timeout = new BilibiliError('请求 B 站接口超时', 'TIMEOUT')
      timeout.retryable = true
      throw timeout
    }
    const network = new BilibiliError(`无法连接 B 站接口：${err.message}`, 'NETWORK')
    network.retryable = true
    throw network
  } finally {
    clearTimeout(timer)
  }
}

/** Run an async operation with backoff retries (Bilibili throttles heavily). */
async function withRetry(fn, retries) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 700 * attempt * attempt))
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn()
    } catch (err) {
      lastError = err
      if (!err.retryable || attempt === retries) throw err
    }
  }
  throw lastError
}

async function requestOnce(path) {
  const res = await fetchOnce(`${API_BASE}${path}`, buildHeaders())
  return res.json()
}

/** GET JSON with backoff retries. */
async function requestJson(path, { retries = MAX_RETRIES } = {}) {
  return withRetry(() => requestOnce(path), retries)
}

/** GET the HTML video page (a different host, so it survives the api ban). */
async function requestHtml(url, { retries = 1 } = {}) {
  return withRetry(() => fetchOnce(url, buildHtmlHeaders()), retries)
}

function toHttps(url) {
  if (!url) return ''
  return String(url).replace(/^http:\/\//i, 'https://')
}

/** "-" and empty strings are Bilibili's placeholders for "no description". */
function cleanDesc(desc) {
  const text = String(desc || '').trim()
  if (!text || text === '-') return ''
  return text
}

/** Headers for the HTML page (a normal browser navigation). */
function buildHtmlHeaders() {
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Referer: 'https://www.bilibili.com/',
    Cookie: `buvid3=${BUVID}; b_nut=${Math.floor(Date.now() / 1000)}`,
  }
}

const HTML_STATE_RE = /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*\(function/

/**
 * Metadata from the public video page HTML.
 *
 * `api.bilibili.com/x/web-interface/*` is banned for many datacentre IPs
 * (`412 request was banned`), but the video page itself embeds the complete
 * `window.__INITIAL_STATE__.videoData` — title, description, cover, owner,
 * stats and the part list — so this is the last link in the chain and lets a
 * cloud deployment resolve metadata anyway.
 */
export async function fetchMetaFromHtml(bvid) {
  const res = await requestHtml(
    `https://www.bilibili.com/video/${encodeURIComponent(bvid)}/`,
  )
  const html = await res.text()
  const match = html.match(HTML_STATE_RE)
  if (!match) {
    throw new BilibiliError('无法从视频页解析出元数据（页面结构可能已变）', 'HTML_PARSE')
  }
  let state
  try {
    state = JSON.parse(match[1].replace(/:undefined/g, ':null'))
  } catch (err) {
    throw new BilibiliError(`视频页数据解析失败：${err.message}`, 'HTML_PARSE')
  }
  const view = state?.videoData
  if (!view?.bvid) {
    throw new BilibiliError('视频页里没有 videoData', 'HTML_PARSE')
  }
  return normalizeFromView(view, { tags: null, source: 'html' })
}

/**
 * Build the stored record from a Bilibili `View`-shaped payload.
 *
 * Exported because the admin page fetches metadata **in the browser** (JSONP, so
 * the request uses the visitor's own IP instead of the server's, which B 站
 * blocks with 412) and then posts the raw payload back — normalisation
 * (tid → 分区, cover host, pages…) stays in this one place.
 */
export function normalizeFromView(view, { tags = null, source = 'api' } = {}) {
  const pages =
    Array.isArray(view.pages) && view.pages.length
      ? view.pages.map((p) => ({
          page: p.page,
          part: p.part || `P${p.page}`,
          duration: p.duration || 0,
          cid: p.cid,
        }))
      : [{ page: 1, part: view.title, duration: view.duration || 0, cid: view.cid }]

  const stat = view.stat || {}
  const { category, categoryParent } = resolveCategory(view.tid)

  return {
    bvid: view.bvid,
    aid: view.aid,
    cid: view.cid,
    title: view.title,
    desc: cleanDesc(view.desc),
    cover: toHttps(view.pic),
    duration: view.duration || 0,
    pubdate: view.pubdate || 0,
    category,
    categoryParent,
    tags: Array.isArray(tags) ? tags.map((t) => t.tag_name).filter(Boolean).slice(0, 12) : [],
    owner: {
      mid: view.owner?.mid || 0,
      name: view.owner?.name || '未知 UP 主',
      face: toHttps(view.owner?.face),
    },
    stat: {
      view: stat.view || 0,
      danmaku: stat.danmaku || 0,
      reply: stat.reply || 0,
      like: stat.like || 0,
      coin: stat.coin || 0,
      favorite: stat.favorite || 0,
      share: stat.share || 0,
    },
    partCount: pages.length,
    pages,
    metadataState: 'complete',
    metadataSource: source,
  }
}

/**
 * Fetch metadata for one video: API (full, includes tags) → API (light) →
 * video-page HTML. Errors carry `.transient` so the caller can decide between
 * "reject this bvid" and "keep it and retry later".
 *
 * @returns {Promise<object>} normalized record
 */
export async function fetchVideoMeta(input) {
  const id = extractVideoId(input)
  if (!id) {
    const err = new BilibiliError('无法识别视频 ID，请输入 BV 号或视频链接', 'BAD_INPUT')
    err.transient = false
    throw err
  }

  const bvid = id.bvid || ''
  const query = id.bvid ? `bvid=${encodeURIComponent(id.bvid)}` : `aid=${id.aid}`
  const errors = []

  // 1) the aggregate endpoint: View + Tags in one round trip
  try {
    const payload = await requestJson(`/x/web-interface/view/detail?${query}`, { retries: 1 })
    if (payload?.code === 0 && payload.data?.View) {
      return normalizeFromView(payload.data.View, { tags: payload.data.Tags, source: 'api' })
    }
    errors.push(
      markTransient(
        new BilibiliError(
          ERROR_MESSAGES[String(payload?.code)] || payload?.message || '获取视频信息失败',
          String(payload?.code),
        ),
      ),
    )
  } catch (err) {
    errors.push(markTransient(err))
  }

  // 2) the lightweight endpoint (no tags)
  try {
    const payload = await requestJson(`/x/web-interface/view?${query}`, { retries: 1 })
    if (payload?.code === 0 && payload.data) {
      return normalizeFromView(payload.data, { tags: null, source: 'api' })
    }
    errors.push(
      markTransient(
        new BilibiliError(
          ERROR_MESSAGES[String(payload?.code)] || payload?.message || '获取视频信息失败',
          String(payload?.code),
        ),
      ),
    )
  } catch (err) {
    errors.push(markTransient(err))
  }

  // 3) the video page HTML (different host: survives the api ban)
  if (bvid) {
    try {
      return await fetchMetaFromHtml(bvid)
    } catch (err) {
      errors.push(markTransient(err))
    }
  }

  // Report a non-transient reason if there is one (e.g. "视频不存在"),
  // otherwise the most informative transient one — annotated with every link
  // that was tried, so /admin shows *why* a 补齐 failed (e.g. the API and the
  // video-page HTML are both banned from a datacentre IP).
  const SOURCE_LABELS = ['接口 view/detail', '接口 view', '视频页 HTML']
  const attempted = errors.map((e, i) => `${SOURCE_LABELS[i] || '接口'} ${e.code || '失败'}`)
  const primary = errors.find((e) => !e.transient) || errors[0]
  if (!primary) throw new BilibiliError('获取视频信息失败', 'UNKNOWN')
  if (attempted.length > 1) {
    primary.message = `${primary.message}（本次尝试：${attempted.join('；')}）`
  }
  throw primary
}

export const BILIBILI_HOSTS = ['hdslb.com', 'biliimg.com', 'bilivideo.com']

/* ------------------------------------------------------------------ *
 * comments — GET /x/v2/reply/main?type=1&oid={aid}&mode={2|3}&next={cursor}
 * `oid` is the numeric aid; mode 3 = 热门, mode 2 = 最新; cursor pagination.
 * ------------------------------------------------------------------ */

const REPLY_MODES = { hot: 3, time: 2 }

function normalizeReply(raw, upMid) {
  if (!raw) return null
  const member = raw.member || {}
  return {
    rpid: String(raw.rpid || ''),
    mid: Number(raw.mid || member.mid || 0),
    uname: String(member.uname || '匿名用户'),
    avatar: toHttps(member.avatar || ''),
    message: String(raw.content?.message ?? ''),
    like: Number(raw.like) || 0,
    ctime: Number(raw.ctime) || 0,
    location: String(raw.reply_control?.location || ''),
    isUp: Boolean(upMid) && Number(raw.mid) === Number(upMid),
    subCount: Number(raw.rcount) || 0,
    replies: Array.isArray(raw.replies)
      ? raw.replies.map((r) => normalizeReply(r, upMid)).filter(Boolean)
      : [],
  }
}

/**
 * Read one page of a video's Bilibili comments.
 * @param {{aid: number, mode?: 'hot'|'time', next?: number, ps?: number, upMid?: number}} options
 */
export async function fetchComments({ aid, mode = 'hot', next = 0, ps = 20, upMid = 0 }) {
  const numericAid = Number(aid)
  if (!numericAid) {
    throw new BilibiliError('该视频缺少 aid，无法读取评论（可在后台「刷新元数据」补全）', 'NO_AID')
  }
  const m = REPLY_MODES[mode] ?? 3
  const payload = await requestJson(
    `/x/v2/reply/main?type=1&oid=${numericAid}&mode=${m}&next=${Number(next) || 0}&ps=${ps}`,
  )
  if (payload.code !== 0) {
    throw new BilibiliError(
      ERROR_MESSAGES[String(payload.code)] || payload.message || '获取评论失败',
      String(payload.code),
    )
  }

  const data = payload.data || {}
  const cursor = data.cursor || {}
  // top_replies carries the pinned comment; keep it at the top of page 1
  const list = [...(data.top_replies || []), ...(data.replies || [])]

  return {
    mode: Number(cursor.mode) || m,
    modeName: String(cursor.name || (m === 3 ? '热门评论' : '最新评论')),
    total: Number(cursor.all_count) || 0,
    next: Number(cursor.next) || 0,
    isEnd: cursor.is_end !== false,
    replies: list.map((r) => normalizeReply(r, upMid)).filter(Boolean),
  }
}

/**
 * Bilibili's classic partition ids (tid).
 *
 * The anonymous `view` endpoint stopped returning `tname`/`tname_v2` (they come
 * back as empty strings), but `tid` / `tid_v2` are still populated — so the name
 * is resolved locally. Each entry is `[name, parent]`, where `parent` is the
 * first-level partition used for the site's filter chips.
 */
const TID_TABLE = {
  1: ['动画', '动画'],
  24: ['MAD·AMV', '动画'],
  25: ['MMD·3D', '动画'],
  27: ['综合', '动画'],
  47: ['短片·手书·配音', '动画'],
  86: ['特摄', '动画'],
  210: ['音MAD', '动画'],
  253: ['动画杂谈', '动画'],

  3: ['音乐', '音乐'],
  28: ['原创音乐', '音乐'],
  31: ['翻唱', '音乐'],
  30: ['VOCALOID·UTAU', '音乐'],
  59: ['演奏', '音乐'],
  29: ['三次元音乐', '音乐'],
  130: ['音乐现场', '音乐'],
  193: ['MV', '音乐'],
  194: ['音乐综合', '音乐'],

  4: ['游戏', '游戏'],
  17: ['单机游戏', '游戏'],
  171: ['电子竞技', '游戏'],
  172: ['手机游戏', '游戏'],
  65: ['网络游戏', '游戏'],
  136: ['音游', '游戏'],
  19: ['桌游棋牌', '游戏'],
  121: ['GMV', '游戏'],
  173: ['Mugen', '游戏'],

  5: ['娱乐', '娱乐'],
  138: ['搞笑', '娱乐'],
  21: ['日常', '生活'],
  163: ['手工', '生活'],
  75: ['动物圈', '生活'],
  160: ['生活', '生活'],
  249: ['生活杂谈', '生活'],

  181: ['影视', '影视'],
  182: ['影视杂谈', '影视'],
  183: ['影视剪辑', '影视'],
  85: ['短片', '影视'],
  184: ['预告·资讯', '影视'],
  23: ['电影', '影视'],
  11: ['电视剧', '影视'],
  167: ['纪录片', '影视'],
  177: ['纪录片', '影视'],
  71: ['综艺', '影视'],
  13: ['番剧', '影视'],
  168: ['国创', '影视'],

  36: ['科技', '科技'],
  201: ['科学科普', '科技'],
  124: ['社科·法律·心理', '科技'],
  95: ['数码', '科技'],
  189: ['电脑装机', '科技'],
  190: ['编程', '科技'],
  191: ['软件应用', '科技'],
  192: ['计算机技术', '科技'],
  98: ['机械', '科技'],
  199: ['汽车', '科技'],

  211: ['美食', '美食'],
  76: ['美食圈', '美食'],
  212: ['美食制作', '美食'],
  213: ['美食侦探', '美食'],
  214: ['美食测评', '美食'],
  215: ['田园美食', '美食'],
  216: ['美食记录', '美食'],

  129: ['舞蹈', '舞蹈'],
  20: ['宅舞', '舞蹈'],
  154: ['三次元舞蹈', '舞蹈'],
  156: ['舞蹈教程', '舞蹈'],

  188: ['运动', '运动'],
  234: ['运动综合', '运动'],
  235: ['篮球', '运动'],
  164: ['健身', '运动'],

  155: ['时尚', '时尚'],
  157: ['美妆护肤', '时尚'],
  158: ['仿妆cos', '时尚'],
  159: ['穿搭', '时尚'],

  119: ['鬼畜', '鬼畜'],
  22: ['鬼畜调教', '鬼畜'],
  26: ['音MAD', '鬼畜'],
  126: ['人力VOCALOID', '鬼畜'],
  127: ['鬼畜剧场', '鬼畜'],
  128: ['教程演示', '鬼畜'],
}

/**
 * Resolve a tid into `{ category, categoryParent }`.
 * Tids outside the table (Bilibili keeps adding partitions) fall back to 其他
 * rather than leaking a raw number into the UI.
 */
export function resolveCategory(tid) {
  const entry = TID_TABLE[Number(tid)]
  if (entry) return { category: entry[0], categoryParent: entry[1] }
  return { category: '其他', categoryParent: '其他' }
}

/** Guard for the image proxy: only Bilibili CDN hosts are allowed. */
export function isAllowedImageHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  return BILIBILI_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}
