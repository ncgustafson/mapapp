import * as Cesium from 'cesium'
import { proxied } from '../lib/proxy'

export type PlaceKind = 'city' | 'peak' | 'pass'

export type PlaceLandmark = {
  id: string
  name: string
  lat: number
  lon: number
  kind: PlaceKind
  rank: number // population for cities, elevation in meters for peaks/passes
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

export async function fetchPlaceLandmarks(rectangle: Cesium.Rectangle): Promise<PlaceLandmark[]> {
  const south = Cesium.Math.toDegrees(rectangle.south)
  const west = Cesium.Math.toDegrees(rectangle.west)
  const north = Cesium.Math.toDegrees(rectangle.north)
  const east = Cesium.Math.toDegrees(rectangle.east)
  const bbox = `${south},${west},${north},${east}`

  // Peaks, passes, and populated places — all simple nodes, so a single
  // `out body` query covers them cheaply. Lakes/glaciers are OSM areas
  // (way/relation) needing `out center`, which proved too slow/unreliable
  // on the public Overpass server for this always-on use case — left out
  // for now.
  const query = `[out:json][timeout:15];(node["place"~"^(city|town)$"]["population"](${bbox});node["natural"="peak"]["name"](${bbox});node["mountain_pass"]["name"](${bbox}););out body;`

  const overpassUrl = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`
  // A slow/hanging Overpass response shouldn't be able to stall this
  // always-on layer indefinitely — fail fast and just keep showing
  // whatever's already cached.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 14000)
  let res: Response
  try {
    res = await fetch(proxied(overpassUrl), { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
  if (!res.ok) throw new Error(`Overpass request failed: ${res.status}`)
  const data = await res.json()

  const landmarks: PlaceLandmark[] = []
  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {}
    if (!tags.name || typeof el.lat !== 'number' || typeof el.lon !== 'number') continue
    const id = `${el.type}/${el.id}`

    if (tags.place === 'city' || tags.place === 'town') {
      const population = Number(tags.population)
      if (!Number.isFinite(population)) continue
      landmarks.push({ id, name: tags.name, lat: el.lat, lon: el.lon, kind: 'city', rank: population })
    } else if (tags.natural === 'peak') {
      const elevation = Number(tags.ele)
      landmarks.push({
        id,
        name: tags.name,
        lat: el.lat,
        lon: el.lon,
        kind: 'peak',
        rank: Number.isFinite(elevation) ? elevation : 0,
      })
    } else if (tags.mountain_pass) {
      const elevation = Number(tags.ele)
      landmarks.push({
        id,
        name: tags.name,
        lat: el.lat,
        lon: el.lon,
        kind: 'pass',
        rank: Number.isFinite(elevation) ? elevation : 0,
      })
    }
  }
  return landmarks
}

export function rectangleContains(outer: Cesium.Rectangle, inner: Cesium.Rectangle): boolean {
  return outer.west <= inner.west && outer.east >= inner.east && outer.south <= inner.south && outer.north >= inner.north
}

export function padRectangle(rect: Cesium.Rectangle, fraction: number): Cesium.Rectangle {
  const width = rect.east - rect.west
  const height = rect.north - rect.south
  const padW = (width * fraction) / 2
  const padH = (height * fraction) / 2
  return new Cesium.Rectangle(rect.west - padW, rect.south - padH, rect.east + padW, rect.north + padH)
}

/**
 * Picks which landmarks to show, enforcing a minimum on-screen pixel
 * distance between them. This is what creates the "fewer labels when
 * zoomed out" effect — at low zoom, everything is visually close together
 * so only the highest-ranked (per group) survives; zoomed in, items spread
 * apart on screen and more of them fit.
 */
export function declutterPlacesByScreenSpace<T extends { lat: number; lon: number }>(
  viewer: Cesium.Viewer,
  groups: { items: T[]; maxCount: number }[],
  minPixelDistance = 70,
): T[] {
  const canvas = viewer.scene.canvas
  const chosenPositions: Cesium.Cartesian2[] = []
  const result: T[] = []

  for (const group of groups) {
    let count = 0
    for (const item of group.items) {
      if (count >= group.maxCount) break
      const cartesian = Cesium.Cartesian3.fromDegrees(item.lon, item.lat)
      const pos = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, cartesian)
      if (!pos) continue
      if (pos.x < 0 || pos.y < 0 || pos.x > canvas.clientWidth || pos.y > canvas.clientHeight) continue

      const tooClose = chosenPositions.some((p) => Cesium.Cartesian2.distance(p, pos) < minPixelDistance)
      if (tooClose) continue

      chosenPositions.push(pos)
      result.push(item)
      count++
    }
  }

  return result
}
