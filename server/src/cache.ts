export type CacheEntry = {
  expiresAt: number
  status: number
  contentType: string
  body: Buffer
}

// In-memory cache — fine for a single server instance and this traffic
// level. If this ever needs to scale to multiple instances, swap this for
// a shared store (e.g. Redis) without changing the calling code.
const store = new Map<string, CacheEntry>()

export function getCached(key: string): CacheEntry | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  return entry
}

export function setCached(key: string, entry: CacheEntry): void {
  store.set(key, entry)
}

export function cacheSize(): number {
  return store.size
}
