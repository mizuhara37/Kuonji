/**
 * Standalone Node server (local development / self-hosting).
 *
 * The actual request handling lives in server/handler.js so the exact same code
 * can run as a Vercel serverless function (see api/index.js).
 *
 *   node server/index.js
 *   PORT=9000 ADMIN_TOKEN=secret node server/index.js
 */
import './env.js' // must come first: loads .env before anything reads process.env
import { createServer } from 'node:http'

import { authRequired, handleRequest } from './handler.js'
import { canWriteFiles, describeLocation, driver } from './backend.js'
import { config, configPath } from './config.js'

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'

const server = createServer(handleRequest)

server.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`
  console.log(`${config.siteName}`)
  console.log(`  品牌      ${configPath}`)
  console.log(`  站点      ${base}/`)
  console.log(`  投稿后台  ${base}/admin`)
  console.log(`  存储      ${describeLocation()} (${driver})`)
  if (!canWriteFiles()) {
    console.warn('  ⚠ 当前环境不可写文件，且未配置 KV：写操作会失败。')
  }
  if (!authRequired) {
    console.warn(
      '  ⚠ 未设置 ADMIN_TOKEN：任何人都能通过 /admin 或 API 修改视频库。\n' +
        '    部署到公网前请设置：ADMIN_TOKEN=你的口令',
    )
  } else {
    console.log('  鉴权      ADMIN_TOKEN 已启用（写操作需要口令）')
  }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
