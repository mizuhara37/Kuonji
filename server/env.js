/**
 * Minimal .env loader — no dependency.
 *
 * Must be imported BEFORE any module that reads process.env at load time
 * (server/handler.js reads ADMIN_TOKEN, server/backend.js reads the KV vars),
 * which works because ESM imports are evaluated in source order.
 *
 * Real environment variables always win over .env, so a platform-provided value
 * (e.g. Vercel env settings) is never overridden by a stray local file.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

try {
  const text = readFileSync(join(ROOT, '.env'), 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue

    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key && !(key in process.env)) process.env[key] = value
  }
} catch (err) {
  // no .env file (or unreadable) — nothing to do
}
