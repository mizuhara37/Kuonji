import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

/**
 * Branding comes from the repo-root `config.json` (or `M37_CONFIG`) so the site
 * name is editable in one place. It is injected into the bundle as
 * `__SITE_CONFIG__` (see src/constants.js) and also used for the HTML shell.
 */
const configPath = new URL(process.env.M37_CONFIG || './config.json', import.meta.url)
let siteConfig = {}
try {
  siteConfig = JSON.parse(readFileSync(configPath, 'utf8'))
} catch (err) {
  console.warn(`[vite] 未读到 ${configPath.pathname}，使用默认站点名`)
}
siteConfig = {
  brandOwner: 'Example',
  brandProduct: 'VideoHub',
  siteName: `${siteConfig.brandOwner || 'Example'} ${siteConfig.brandProduct || 'VideoHub'}`,
  tagline: '基于 Material Design 3 构建的视频分享站点',
  footerNote: '版权所有 · 视频与信息来自哔哩哔哩 · 基于 Material Design 3 构建',
  repoUrl: '',
  deployUrl: '',
  ...siteConfig,
}
if (!siteConfig.siteName) siteConfig.siteName = `${siteConfig.brandOwner} ${siteConfig.brandProduct}`

/** Rewrite the static HTML shell with the configured name. */
function siteBrandingPlugin() {
  return {
    name: 'm37-site-branding',
    transformIndexHtml(html) {
      return html
        .replace(/<title>.*?<\/title>/, `<title>${siteConfig.siteName}</title>`)
        .replace(
          /(name="description"\s+content=")[^"]*(")/,
          `$1${siteConfig.siteName} — ${siteConfig.tagline}$2`,
        )
    },
  }
}

/**
 * The SPA talks to the Node server (`server/index.js`) over /api.
 * In production that same server also serves dist/, so no proxy is needed —
 * it exists for `npm run dev` / `npm run preview` on a separate port.
 */
const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true }), siteBrandingPlugin()],
  define: {
    __SITE_CONFIG__: JSON.stringify(siteConfig),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split the framework out of the app chunk so route chunks stay small.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('vuetify')) return 'vendor-vuetify'
            if (id.includes('@mdi')) return 'vendor-icons'
            return 'vendor'
          }
          return undefined
        },
      },
    },
  },
})
