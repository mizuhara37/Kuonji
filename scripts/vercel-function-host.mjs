/**
 * Runs api/index.js exactly the way Vercel's Node runtime does: the default
 * export is a plain `(req, res)` handler, here attached to node:http.
 *
 *   node scripts/vercel-function-host.mjs         # PORT=8899
 */
import { createServer } from 'node:http'
import handler from '../api/index.js'

const PORT = Number(process.env.PORT || 8899)
const HOST = process.env.HOST || '127.0.0.1'

createServer(handler).listen(PORT, HOST, () => {
  console.log(`vercel function host on http://${HOST}:${PORT}`)
})
