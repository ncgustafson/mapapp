import express from 'express'
import cors from 'cors'
import { getCached, setCached, cacheSize } from './cache.js'
import { isAllowedUrl } from './allowlist.js'

const app = express()
const PORT = process.env.PORT ? Number(process.env.PORT) : 8787

// NWS API docs ask API consumers to identify themselves via User-Agent.
// Set CONTACT_INFO (e.g. an email) as an env var if you want to comply —
// optional, so this falls back to a generic descriptive string.
const USER_AGENT = `MountainView weather map (${process.env.CONTACT_INFO ?? 'no contact set'})`

const DEFAULT_TTL_SECONDS = 3600 // 1 hour — matches NOAA's own gridpoint cache-control guidance
const MAX_TTL_SECONDS = 6 * 3600

app.use(cors())

app.get('/proxy', async (req, res) => {
  const target = req.query.url
  if (typeof target !== 'string' || !isAllowedUrl(target)) {
    res.status(400).json({ error: 'invalid or disallowed url' })
    return
  }

  const cached = getCached(target)
  if (cached) {
    res.status(cached.status)
    res.set('Content-Type', cached.contentType)
    res.set('X-Cache', 'HIT')
    res.send(cached.body)
    return
  }

  try {
    const upstream = await fetch(target, {
      headers: { 'User-Agent': USER_AGENT },
    })
    const body = Buffer.from(await upstream.arrayBuffer())
    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'

    // Respect the origin's own max-age when present, otherwise fall back to
    // our default — capped, so a misbehaving origin can't make us cache
    // something stale for an unreasonable length of time.
    let ttlSeconds = DEFAULT_TTL_SECONDS
    const cacheControl = upstream.headers.get('cache-control')
    const match = cacheControl?.match(/max-age=(\d+)/)
    if (match) {
      ttlSeconds = Math.min(Number(match[1]), MAX_TTL_SECONDS)
    }

    if (upstream.ok) {
      setCached(target, {
        expiresAt: Date.now() + ttlSeconds * 1000,
        status: upstream.status,
        contentType,
        body,
      })
    }

    res.status(upstream.status)
    res.set('Content-Type', contentType)
    res.set('X-Cache', 'MISS')
    res.send(body)
  } catch {
    res.status(502).json({ error: 'upstream fetch failed' })
  }
})

app.get('/health', (_req, res) => {
  res.json({ ok: true, cacheSize: cacheSize() })
})

app.listen(PORT, () => {
  console.log(`Proxy server listening on port ${PORT}`)
})
