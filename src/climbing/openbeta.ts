// OpenBeta (https://openbeta.io) is a free, crowd-sourced climbing route
// database with an open GraphQL API, no key required. It's the only viable
// source for this: Mountain Project's API was deprecated in late 2020 and
// all keys revoked by the end of 2022.
const API_URL = 'https://api.openbeta.io/'

// Red Rocks (NV) → Pine Creek Canyon. Hardcoded for now — this feature
// starts with one canyon as a concrete test case; browsing by area name
// comes later.
export const PINE_CREEK_CANYON_UUID = '3030a897-a0a9-525f-91c2-1c97afd37744'

export type ClimbingRoute = {
  id: string
  name: string
  grade: string | null
  wallName: string
  lat: number
  lon: number
  trad: boolean
  sport: boolean
  topRope: boolean
  fa: string | null
  lengthFeet: number | null
}

type AreaNode = {
  area_name: string
  metadata: { lat: number; lng: number }
  children: { uuid: string }[]
  climbs: {
    id: string
    name: string
    grades: { yds: string | null } | null
    type: { trad: boolean | null; sport: boolean | null; tr: boolean | null } | null
    fa: string | null
    length: number | null
  }[]
}

const AREA_QUERY = `
  query AreaNode($uuid: ID!) {
    area(uuid: $uuid) {
      area_name
      metadata { lat lng }
      children { uuid }
      climbs { id name grades { yds } type { trad sport tr } fa length }
    }
  }
`

async function fetchAreaNode(uuid: string): Promise<AreaNode | null> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: AREA_QUERY, variables: { uuid } }),
  })
  if (!res.ok) throw new Error(`OpenBeta request failed: ${res.status}`)
  const body = await res.json()
  if (body.errors) throw new Error(body.errors[0]?.message ?? 'OpenBeta query failed')
  return body.data.area
}

// One retry, after a short pause — a canyon-sized tree walk fires enough
// requests in a burst (see mapWithConcurrency below) to occasionally trip
// OpenBeta's rate limiting; a failed response drops CORS headers too, so
// the browser reports it as a opaque CORS error rather than a clean 429.
async function fetchAreaNodeWithRetry(uuid: string): Promise<AreaNode | null> {
  try {
    return await fetchAreaNode(uuid)
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500))
    try {
      return await fetchAreaNode(uuid)
    } catch {
      return null
    }
  }
}

// Caps how many area requests are in flight at once — firing all of a
// canyon's ~25-30 sub-areas in one Promise.all burst is exactly what
// triggers the rate limiting the retry above exists for.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// A sensible-sized canyon can have dozens of sub-areas/walls — this caps a
// pathological (or future, much larger) tree from triggering hundreds of
// requests, mirroring the MAX_TILES guard in mapContext.ts.
const MAX_AREAS = 200
const FETCH_CONCURRENCY = 5

async function walkAreaTree(rootUuid: string): Promise<ClimbingRoute[]> {
  const routes: ClimbingRoute[] = []
  let frontier = [rootUuid]
  let visited = 0

  while (frontier.length > 0 && visited < MAX_AREAS) {
    const batch = frontier.slice(0, MAX_AREAS - visited)
    const nodes = await mapWithConcurrency(batch, FETCH_CONCURRENCY, fetchAreaNodeWithRetry)
    visited += batch.length

    const nextFrontier: string[] = []
    for (const node of nodes) {
      if (!node) continue
      for (const climb of node.climbs ?? []) {
        routes.push({
          id: climb.id,
          name: climb.name,
          grade: climb.grades?.yds || null,
          wallName: node.area_name,
          lat: node.metadata.lat,
          lon: node.metadata.lng,
          trad: Boolean(climb.type?.trad),
          sport: Boolean(climb.type?.sport),
          topRope: Boolean(climb.type?.tr),
          fa: climb.fa || null,
          lengthFeet: climb.length && climb.length > 0 ? climb.length : null,
        })
      }
      for (const child of node.children ?? []) nextFrontier.push(child.uuid)
    }
    frontier = nextFrontier
  }

  return routes
}

const CACHE_PREFIX = 'mapapp.climbing.'
// Route data barely changes day to day — this cache exists less for speed
// and more so repeat visits (and, during dev, repeat reloads) don't
// re-walk a ~25-area tree against a free community API every time. A 429
// from OpenBeta drops its CORS header too, so a tripped rate limit shows up
// in the browser as an opaque "CORS blocked" error rather than a clean 429.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

function loadCachedRoutes(areaUuid: string): ClimbingRoute[] | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + areaUuid)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { fetchedAt: number; routes: ClimbingRoute[] }
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null
    return parsed.routes
  } catch {
    return null
  }
}

function saveCachedRoutes(areaUuid: string, routes: ClimbingRoute[]): void {
  try {
    localStorage.setItem(CACHE_PREFIX + areaUuid, JSON.stringify({ fetchedAt: Date.now(), routes }))
  } catch {
    // localStorage unavailable (e.g. private browsing) — just won't cache
  }
}

/**
 * Walks an OpenBeta area's full subtree (canyon → walls → climbs) and
 * flattens every climb found into a single list, caching the result (see
 * above). Note that a climb's lat/lon is really its *wall's* coordinate,
 * not a per-route survey point — OpenBeta (and every other source checked)
 * has no finer-grained location data than that; every route on the same
 * wall shares one coordinate.
 */
export async function fetchClimbingRoutes(rootUuid: string): Promise<ClimbingRoute[]> {
  const cached = loadCachedRoutes(rootUuid)
  if (cached) return cached

  const routes = await walkAreaTree(rootUuid)
  saveCachedRoutes(rootUuid, routes)
  return routes
}
