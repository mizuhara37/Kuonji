/**
 * Site branding, read from config.json (see the repo root).
 *
 * One file drives the name everywhere:
 *   • front-end  — Vite injects it at build time (`__SITE_CONFIG__`, see vite.config.js)
 *   • server     — this module (startup banner + `GET /api/config` for /admin)
 *   • admin page — fetches `GET /api/config` at runtime
 *
 * Point `M37_CONFIG` at another JSON file to use a different branding without
 * touching the committed config (handy when you don't want your real name in git).
 */
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const DEFAULTS = {
  brandOwner: 'Kuonji',
  brandProduct: 'VideoHub',
  siteName: '',
  tagline: '基于 Material Design 3 构建的视频分享站点',
  footerNote: '视频与信息来自哔哩哔哩 · 基于 Material Design 3 构建',
  repoUrl: '',
  deployUrl: '',
  // 外观：主色 / 背景 / 图标
  primaryColor: '#6BBF8A',
  backgroundColor: '',
  backgroundColorDark: '',
  backgroundImage: '',
  backgroundOpacity: 0.35,
  icon: '',
}

export const configPath = (() => {
  const custom = process.env.M37_CONFIG
  if (!custom) return join(ROOT, 'config.json')
  return isAbsolute(custom) ? custom : resolve(ROOT, custom)
})()

function readConfig() {
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    const merged = { ...DEFAULTS, ...parsed }
    merged.siteName = String(merged.siteName || `${merged.brandOwner} ${merged.brandProduct}`).trim()
    return merged
  } catch (err) {
    // Missing / broken config must never take the site down — fall back to the
    // example branding and say so once in the log.
    if (err.code !== 'ENOENT') console.warn(`[config] 读取 ${configPath} 失败：${err.message}`)
    const fallback = { ...DEFAULTS }
    fallback.siteName = `${fallback.brandOwner} ${fallback.brandProduct}`
    return fallback
  }
}

export const config = readConfig()

/** Branding payload shared with the front-end / admin page (no secrets in it). */
export function publicConfig() {
  return {
    brandOwner: config.brandOwner,
    brandProduct: config.brandProduct,
    siteName: config.siteName,
    tagline: config.tagline,
    footerNote: config.footerNote,
    repoUrl: config.repoUrl,
    deployUrl: config.deployUrl,
    primaryColor: config.primaryColor,
    backgroundColor: config.backgroundColor,
    backgroundColorDark: config.backgroundColorDark,
    backgroundImage: config.backgroundImage,
    backgroundOpacity: config.backgroundOpacity,
    icon: config.icon,
  }
}
