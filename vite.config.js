import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

/**
 * Branding comes from the repo-root `config.json`, or from another JSON file
 * when `M37_CONFIG` points at one — set it in `.env` so both `npm run build`
 * and `npm run start` agree without exporting anything by hand:
 *
 *     M37_CONFIG=./my-config.local     # .env（*.local 已被 gitignore）
 *
 * The resolved values are injected into the bundle as `__SITE_CONFIG__`
 * (see src/constants.js) and used to rewrite the HTML shell.
 */
function resolveSiteConfig(env) {
  const configPath = new URL(env.M37_CONFIG || './config.json', import.meta.url)
  let parsed = {}
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (err) {
    console.warn(`[vite] 未读到 ${configPath.pathname}，使用默认站点名`)
  }
  const merged = {
    brandOwner: 'Example',
    brandProduct: 'VideoHub',
    tagline: '基于 Material Design 3 构建的视频分享站点',
    footerNote: '版权所有 · 视频与信息来自哔哩哔哩 · 基于 Material Design 3 构建',
    repoUrl: '',
    deployUrl: '',
    ...parsed,
  }
  merged.siteName = String(
    merged.siteName || `${merged.brandOwner} ${merged.brandProduct}`,
  ).trim()
  merged.configFile = configPath.pathname
  return merged
}

/** Rewrite the static HTML shell with the configured name. */
function siteBrandingPlugin(siteConfig) {
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
export default defineConfig(({ mode }) => {
  // real environment wins over .env, matching server/env.js
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const siteConfig = resolveSiteConfig(env)
  if (env.M37_CONFIG) console.log(`[vite] 站点品牌来自 ${siteConfig.configFile}`)

  const API_TARGET = env.API_TARGET || 'http://127.0.0.1:8787'

  return {
    plugins: [vue(), vuetify({ autoImport: true }), siteBrandingPlugin(siteConfig)],
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
  }
})
