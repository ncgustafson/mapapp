import * as Cesium from 'cesium'
import { PbfReader } from 'pbf'
import { VectorTile } from '@mapbox/vector-tile'
import { fetchPlaceLandmarks, type PlaceLandmark } from '../places/placeLandmarks'
import type { LatLon } from './routeTypes'

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined
const PLANET_URL = 'https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf'
// The transportation/poi layers exist up to z15, but named trail segments
// and POIs are sparse below ~z13 (verified directly against real tiles) —
// this is the zoom where useful named features actually start showing up
// without needing so many tiles that a bounds query gets slow.
const FEATURE_ZOOM = 13
// A bounding box query fetches every tile it overlaps — cap it so a
// careless huge bounds (or the agent asking for "everything") can't try to
// pull down hundreds of tiles.
const MAX_TILES = 16
// Real trail geometry from the vector tiles can run 100-250+ points for one
// segment — far more detail than the agent needs to place a route, and
// expensive to feed back in as tool output on every call. Downsampled to a
// still-representative shape.
const MAX_POINTS_PER_TRAIL = 25

function downsample(points: LatLon[], max: number): LatLon[] {
  if (points.length <= max) return points
  const step = (points.length - 1) / (max - 1)
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)])
}

export type PathSegment = { name: string; type: 'trail' | 'road'; points: LatLon[] }
export type PointOfInterest = { name: string; category: string; lat: number; lon: number }
export type Bounds = { west: number; south: number; east: number; north: number }

const TRAIL_SUBCLASSES = new Set(['footway', 'path', 'track', 'bridleway'])
// Everything else that shows up as a named "class" in this layer is a road
// of some kind (OpenMapTiles road hierarchy) — trails are identified by
// subclass instead (they all share class "path"), so anything with a road
// class here is real drivable/rideable road, useful for an approach leg or
// a route that's meant to follow a forest service road rather than a trail.
const ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'])
// MapTiler's own Outdoor style groups these poi classes as "outdoor"-relevant
// (bench/board/guidepost/etc.) and "outdoor water" (drinking_water/spring/
// etc.) — reused here since it's the same taxonomy MapTiler itself curated
// for this exact use case.
const POI_CATEGORIES: Record<string, string> = {
  camp_site: 'campsite',
  picnic_site: 'picnic site',
  shelter: 'shelter',
  viewpoint: 'viewpoint',
  drinking_water: 'water source',
  spring: 'water source',
  fountain: 'water source',
  hot_spring: 'hot spring',
  waterfall: 'waterfall',
  cave_entrance: 'cave',
  parking: 'parking / trailhead',
  information: 'information',
  info_office: 'information',
  guidepost: 'guidepost',
  first_aid: 'first aid',
  mountain_rescue: 'mountain rescue',
}

function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z)
}

function tileToLonLat(z: number, x: number, y: number, px: number, py: number, extent: number): LatLon {
  const n = 2 ** z
  const lon = ((x + px / extent) / n) * 360 - 180
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / extent)) / n)))
  return { lat: (latRad * 180) / Math.PI, lon }
}

function tilesCovering(bounds: Bounds, zoom: number, maxTiles = MAX_TILES): { x: number; y: number }[] {
  const minX = lonToTileX(bounds.west, zoom)
  const maxX = lonToTileX(bounds.east, zoom)
  // Latitude increases upward but tile Y increases downward.
  const minY = latToTileY(bounds.north, zoom)
  const maxY = latToTileY(bounds.south, zoom)

  const tiles: { x: number; y: number }[] = []
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      tiles.push({ x, y })
      if (tiles.length >= maxTiles) return tiles
    }
  }
  return tiles
}

// A bounds query fetches several of these in parallel via Promise.all — with
// no timeout, one stalled connection (no response, no error, just hangs)
// blocks the whole tool call until the agent's own 90s ceiling eventually
// kills the entire request, not just this one fetch. Confirmed as the actual
// cause of a real hang ("stuck on searching for Skyline Trail").
const TILE_FETCH_TIMEOUT_MS = 8000

async function fetchTile(z: number, x: number, y: number): Promise<VectorTile | null> {
  const url = PLANET_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
  const res = await fetch(`${url}?key=${MAPTILER_KEY}`, { signal: AbortSignal.timeout(TILE_FETCH_TIMEOUT_MS) })
  if (!res.ok) return null
  const buf = await res.arrayBuffer()
  return new VectorTile(new PbfReader(new Uint8Array(buf)))
}

/** Named peaks, mountain passes, and cities/towns in the given area — the
 * same GNIS + bundled-cities data the map's own place labels use. */
export async function findLandmarks(viewer: Cesium.Viewer, bounds: Bounds, limit = 25): Promise<PlaceLandmark[]> {
  const rectangle = Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north)
  const landmarks = await fetchPlaceLandmarks(viewer, rectangle)
  return landmarks.sort((a, b) => b.rank - a.rank).slice(0, limit)
}

/** Named trail and road segments in the given area, with their real
 * geometry — pulled from MapTiler's vector tiles (not a separate/less
 * reliable source; same provider already used elsewhere in this app). A
 * real route almost always follows an existing trail or road rather than
 * cutting cross-country, so this is the first thing to check before
 * proposing a freehand path.
 * Pass `nameFilter` to only return segments whose name contains it
 * (case-insensitive) — much cheaper than fetching everything in the area
 * when the agent already knows which named trail/road it's after. Long
 * trails/roads (e.g. the ~93mi Wonderland Trail) are naturally split into
 * many separate segments in the underlying data — this returns whichever
 * of those segments fall within `bounds`, not the full length. */
export async function findPaths(bounds: Bounds, nameFilter?: string, limit = 20): Promise<PathSegment[]> {
  if (!MAPTILER_KEY) return []
  const tiles = tilesCovering(bounds, FEATURE_ZOOM)
  const tileData = await Promise.all(tiles.map((t) => fetchTile(FEATURE_ZOOM, t.x, t.y).catch(() => null)))
  const needle = nameFilter?.toLowerCase()

  const segments: PathSegment[] = []
  tileData.forEach((tile, i) => {
    if (!tile) return
    // Despite the name, this carries full line geometry (verified directly
    // against real tiles) — the plain "transportation" layer has the same
    // paths but no "name" property at all.
    const layer = tile.layers.transportation_name
    if (!layer) return
    const { x, y } = tiles[i]
    for (let f = 0; f < layer.length; f++) {
      const feature = layer.feature(f)
      const name = feature.properties.name
      if (typeof name !== 'string' || !/[a-z]/i.test(name)) continue // skip bare route-number labels
      const cls = String(feature.properties.class ?? '')
      const isTrail = cls === 'path' && TRAIL_SUBCLASSES.has(String(feature.properties.subclass ?? ''))
      const isRoad = ROAD_CLASSES.has(cls)
      if (!isTrail && !isRoad) continue
      if (needle && !name.toLowerCase().includes(needle)) continue
      const geometry = feature.loadGeometry()[0] // first path is enough to place/orient the path
      if (!geometry || geometry.length < 2) continue
      const points = geometry.map((p) => tileToLonLat(FEATURE_ZOOM, x, y, p.x, p.y, layer.extent))
      segments.push({ name, type: isTrail ? 'trail' : 'road', points: downsample(points, MAX_POINTS_PER_TRAIL) })
    }
  })

  // Without a name filter, a broad-area query dedupes to one representative
  // segment per name (enough to know the path exists and roughly where).
  // *With* a name filter the agent is specifically after that one trail/
  // road's actual path, so every matching segment is kept — that's the
  // whole point of filtering, since long ones are naturally split into many
  // segments.
  if (needle) return segments.slice(0, limit)
  const byName = new Map<string, PathSegment>()
  for (const seg of segments) if (!byName.has(seg.name)) byName.set(seg.name, seg)
  return Array.from(byName.values()).slice(0, limit)
}

/** Every trail/road line geometry in the given area — named or not, at full
 * resolution, not deduped — for building a routable network graph (see
 * trailNetwork.ts). findPaths (above) is a different, LLM-facing shape of
 * roughly this same data: named-only, downsampled, deduped for token
 * economy. This is the raw material for actual geometric snapping/pathing,
 * where unnamed connector segments matter (a real trail network isn't just
 * the named through-trails) and full vertex density matters (snapping to a
 * simplified line would be visibly less accurate). */
export async function fetchNetworkGeometry(bounds: Bounds, maxTiles = MAX_TILES): Promise<LatLon[][]> {
  if (!MAPTILER_KEY) return []
  const tiles = tilesCovering(bounds, FEATURE_ZOOM, maxTiles)
  const tileData = await Promise.all(tiles.map((t) => fetchTile(FEATURE_ZOOM, t.x, t.y).catch(() => null)))

  const lines: LatLon[][] = []
  tileData.forEach((tile, i) => {
    if (!tile) return
    const layer = tile.layers.transportation
    if (!layer) return
    const { x, y } = tiles[i]
    for (let f = 0; f < layer.length; f++) {
      const feature = layer.feature(f)
      const cls = String(feature.properties.class ?? '')
      const isTrail = cls === 'path' && TRAIL_SUBCLASSES.has(String(feature.properties.subclass ?? ''))
      const isRoad = ROAD_CLASSES.has(cls)
      if (!isTrail && !isRoad) continue
      for (const path of feature.loadGeometry()) {
        if (path.length < 2) continue
        lines.push(path.map((p) => tileToLonLat(FEATURE_ZOOM, x, y, p.x, p.y, layer.extent)))
      }
    }
  })
  return lines
}

/** Named outdoor points of interest (campsites, water sources, shelters,
 * viewpoints, trailhead parking, etc.) in the given area, from the same
 * MapTiler vector source as findPaths. */
export async function findPointsOfInterest(bounds: Bounds, limit = 25): Promise<PointOfInterest[]> {
  if (!MAPTILER_KEY) return []
  const tiles = tilesCovering(bounds, FEATURE_ZOOM)
  const tileData = await Promise.all(tiles.map((t) => fetchTile(FEATURE_ZOOM, t.x, t.y).catch(() => null)))

  const pois: PointOfInterest[] = []
  tileData.forEach((tile, i) => {
    if (!tile) return
    const layer = tile.layers.poi
    if (!layer) return
    const { x, y } = tiles[i]
    for (let f = 0; f < layer.length; f++) {
      const feature = layer.feature(f)
      const category = POI_CATEGORIES[String(feature.properties.class ?? '')]
      if (!category) continue
      const geometry = feature.loadGeometry()[0]?.[0]
      if (!geometry) continue
      const { lat, lon } = tileToLonLat(FEATURE_ZOOM, x, y, geometry.x, geometry.y, layer.extent)
      const name = typeof feature.properties.name === 'string' ? feature.properties.name : category
      pois.push({ name, category, lat, lon })
    }
  })

  return pois.slice(0, limit)
}
