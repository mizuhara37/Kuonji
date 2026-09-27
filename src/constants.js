/**
 * Site identity — driven by the repo-root `config.json` (injected at build time
 * by vite.config.js as `__SITE_CONFIG__`), so the name lives in exactly one file.
 */
const injected = typeof __SITE_CONFIG__ !== 'undefined' ? __SITE_CONFIG__ : {}

const FALLBACK = {
  brandOwner: 'Kuonji',
  brandProduct: 'VideoHub',
  siteName: 'Kuonji VideoHub',
  tagline: '基于 Material Design 3 构建的视频分享站点',
  footerNote: '视频与信息来自哔哩哔哩 · 基于 Material Design 3 构建',
  repoUrl: '',
  deployUrl: '',
  primaryColor: '#6BBF8A',
  backgroundColor: '',
  backgroundColorDark: '',
  backgroundImage: '',
  backgroundOpacity: 0.35,
  icon: '',
}

export const siteConfig = { ...FALLBACK, ...injected }

export const SITE_NAME = siteConfig.siteName

export const BRAND_OWNER = siteConfig.brandOwner

export const BRAND_PRODUCT = siteConfig.brandProduct

