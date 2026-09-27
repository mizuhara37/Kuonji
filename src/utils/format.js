/**
 * Formatting + hashing helpers shared across the app.
 * (Formerly `mock/random.js` — the seeded generators were removed along with
 * the seed dataset, so only deterministic utilities remain.)
 */

/** FNV-1a string hash — used for deterministic colours and ids. */
export function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  }
  return h >>> 0
}

/** Golden-angle hue so consecutive ids get clearly different colours. */
export function hueFor(id) {
  const n = typeof id === 'number' ? id : hashString(String(id))
  return Math.round((n * 137.508) % 360)
}

/** 12345 -> "1.2万" ; 123456789 -> "1.2亿" */
export function formatCount(n) {
  const num = Number(n) || 0
  if (num >= 100000000) {
    const v = num / 100000000
    return `${v >= 10 ? Math.round(v) : v.toFixed(1)}亿`
  }
  if (num >= 10000) {
    const v = num / 10000
    return `${v >= 10 ? Math.round(v) : v.toFixed(1)}万`
  }
  return String(num)
}

function pad(n) {
  return String(n).padStart(2, '0')
}

/** 2022-10-01 14:00:00 — matches the reference project's `time` field. */
export function formatDateTime(date) {
  const d = date instanceof Date ? date : new Date(date)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** "3分钟前" / "2天前" / "2024-05-01" */
export function relativeTime(date) {
  const then = (date instanceof Date ? date : new Date(date)).getTime()
  const diff = Date.now() - then
  if (Number.isNaN(diff)) return ''
  const min = 60 * 1000
  if (diff < min) return '刚刚'
  if (diff < 60 * min) return `${Math.floor(diff / min)}分钟前`
  if (diff < 24 * 60 * min) return `${Math.floor(diff / (60 * min))}小时前`
  if (diff < 30 * 24 * 60 * min) return `${Math.floor(diff / (24 * 60 * min))}天前`
  return formatDateTime(then).slice(0, 10)
}

/** 83 -> "01:23" ; 3723 -> "01:02:03" */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(sec)}`
  return `${pad(m)}:${pad(sec)}`
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}
