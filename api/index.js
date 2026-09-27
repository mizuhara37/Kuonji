/**
 * Vercel serverless entry.
 *
 * Everything under /api/* is rewritten to this function (see vercel.json); it
 * delegates to the same handler the standalone server uses.
 *
 * IMPORTANT — on Vercel the filesystem is read-only (and /tmp is per-invocation),
 * so the library MUST live in an external store. Set either
 *   KV_REST_API_URL + KV_REST_API_TOKEN            (Vercel KV)
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 * and the store switches to that driver automatically (server/backend.js).
 *
 * Also set ADMIN_TOKEN so the write endpoints are not open to the public.
 */
import '../server/env.js' // loads .env locally; platform env vars always win
import { handleRequest } from '../server/handler.js'

export default function handler(req, res) {
  return handleRequest(req, res)
}
