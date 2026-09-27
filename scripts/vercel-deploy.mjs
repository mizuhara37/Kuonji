/**
 * Deploy the current working tree to Vercel through the REST API.
 *
 * Why this exists in addition to `npx vercel deploy`: the Vercel CLI insists on
 * loading a *user* profile, which some team-scoped tokens cannot provide
 * ("User not found"). The REST API accepts those tokens fine, so this script
 * uploads the source files inline and creates a production deployment, then
 * waits for it to become READY.
 *
 *   node scripts/vercel-deploy.mjs               # uses .vercel-token / VERCEL_TOKEN
 *   node scripts/vercel-deploy.mjs --no-wait
 *   node scripts/vercel-deploy.mjs --target preview
 *
 * Requires `.vercel/project.json` (created by `npx vercel link`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'

import '../server/env.js' // .env first, so M37_CONFIG is visible next
import { config, configPath } from '../server/config.js'

const ARGS = process.argv.slice(2)
const target = ARGS.includes('--target') ? ARGS[ARGS.indexOf('--target') + 1] : 'production'
const wait = !ARGS.includes('--no-wait')

function readToken() {
  const fromEnv = process.env.VERCEL_TOKEN
  if (fromEnv) return fromEnv.trim()
  try {
    return readFileSync('.vercel-token', 'utf8').trim()
  } catch (err) {
    console.error('缺少 Vercel Token：设置 VERCEL_TOKEN，或写入 .vercel-token')
    process.exit(1)
  }
}

let project
try {
  project = JSON.parse(readFileSync('.vercel/project.json', 'utf8'))
} catch (err) {
  console.error('找不到 .vercel/project.json：先运行 npx vercel link --project <名字>')
  process.exit(1)
}

const TOKEN = readToken()
const { projectId, orgId, projectName } = project
const ROOT = process.cwd()

/* Files Vercel needs: the Vite build inputs plus the serverless function. */
const FILES = ['index.html', 'package.json', 'package-lock.json', 'vite.config.js', 'vercel.json']
const DIRS = ['src', 'public', 'api', 'server']
const SKIP = [/node_modules/, /[\\/]data[\\/]/, /\.env/, /\.vercel/, /^shots/]

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = relative(ROOT, full).split(sep).join('/')
    if (SKIP.some((re) => re.test(rel))) continue
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(rel)
  }
}

const files = [...FILES]
for (const dir of DIRS) {
  try {
    walk(join(ROOT, dir), files)
  } catch (err) {
    console.warn(`跳过 ${dir}: ${err.message}`)
  }
}

const payload = files.map((file) => ({
  file,
  data: readFileSync(join(ROOT, file)).toString('base64'),
  encoding: 'base64',
}))

// The build on Vercel (and the serverless function) reads config.json, so the
// *effective* branding has to be uploaded even when it lives in another file
// (M37_CONFIG=./my-config.local). Uploaded as config.json.
const effectiveConfig = readFileSync(configPath, 'utf8')
if (!payload.some((f) => f.file === 'config.json')) {
  payload.push({ file: 'config.json', data: Buffer.from(effectiveConfig).toString('base64'), encoding: 'base64' })
} else {
  payload.find((f) => f.file === 'config.json').data = Buffer.from(effectiveConfig).toString('base64')
}
console.log(`上传 ${payload.length} 个文件（${(JSON.stringify(payload).length / 1024).toFixed(0)} KB）→ ${target}`)
console.log(`品牌：${config.siteName}（来自 ${basename(configPath)}）`)

const res = await fetch(`https://api.vercel.com/v13/deployments?teamId=${orgId}&forceNew=1`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: projectName,
    project: projectId,
    target,
    regions: ['hkg1'],
    files: payload,
  }),
  signal: AbortSignal.timeout(180000),
})

const text = await res.text()
let data
try {
  data = JSON.parse(text)
} catch (err) {
  console.error(`HTTP ${res.status}：${text.slice(0, 300)}`)
  process.exit(1)
}
if (res.status !== 200 && res.status !== 201) {
  console.error(`部署请求失败 HTTP ${res.status}`)
  console.error(JSON.stringify(data).slice(0, 500))
  process.exit(1)
}

console.log(`已创建部署 ${data.id} → https://${data.url}`)
if (!wait) process.exit(0)

const deadline = Date.now() + 8 * 60 * 1000
while (Date.now() < deadline) {
  // eslint-disable-next-line no-await-in-loop
  await new Promise((r) => setTimeout(r, 6000))
  // eslint-disable-next-line no-await-in-loop
  const status = await (
    await fetch(`https://api.vercel.com/v13/deployments/${data.id}?teamId=${orgId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
  ).json()
  console.log(`  ${status.readyState || status.status}`)
  if (status.readyState === 'READY') {
    console.log(`\n✔ 就绪：${config.deployUrl || `https://${status.url}`}`)
    console.log(`  部署地址：https://${status.url}`)
    process.exit(0)
  }
  if (status.readyState === 'ERROR' || status.readyState === 'CANCELED') {
    console.error(`部署失败：${status.readyState}`)
    process.exit(1)
  }
}
console.error('等待超时，请到 Vercel 控制台查看')
process.exit(1)
