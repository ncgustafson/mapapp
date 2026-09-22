import * as Cesium from 'cesium'
import { proxied } from '../lib/proxy'
import usCitiesData from './data/us_cities.json'

export type PlaceKind = 'city' | 'peak' | 'pass'

export type PlaceLandmark = {
  id: string
  name: string
  lat: number
  lon: number
  kind: PlaceKind
  rank: number // population for cities, elevation in meters for peaks/passes
}

type UsCity = { name: string; lat: number; lon: number; population: number; state: string }
const US_CITIES = usCitiesData as UsCity[]

// USGS's National Map hosts GNIS (the official US database of named
// geographic features) as a live, public, no-key ArcGIS REST service.
// Originally this layer used Overpass (OpenStreetMap) instead, but its
// public demo server started outright refusing connections under load —
// GNIS is the same official, always-on source already proven reliable for
// the weather Graphical tab's landmark sampling (src/weather/landmarks.ts).
const GNIS_LANDFORMS_URL = 'https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer/5/query'

function citiesInRectangle(rectangle: Cesium.Rectangle, maxCities: number): PlaceLandmark[] {
  const south = Cesium.Math.toDegrees(rectangle.south)
  const west = Cesium.Math.toDegrees(rectangle.west)
  const north = Cesium.Math.toDegrees(rectangle.north)
  const east = Cesium.Math.toDegrees(rectangle.east)

  return US_CITIES.filter((c) => c.lat >= south && c.lat <= north && c.lon >= west && c.lon <= east)
    .sort((a, b) => b.population - a.population)
    .slice(0, maxCities)
    .map((c) => ({
      id: `city/${c.name}/${c.lat.toFixed(3)}/${c.lon.toFixed(3)}`,
      name: c.name,
      lat: c.lat,
      lon: c.lon,
      kind: 'city' as const,
      rank: c.population,
    }))
}

async function fetchGnisFeatures(
  rectangle: Cesium.Rectangle,
  featureClass: 'Summit' | 'Gap',
): Promise<{ name: string; lat: number; lon: number }[]> {
  const south = Cesium.Math.toDegrees(rectangle.south)
  const west = Cesium.Math.toDegrees(rectangle.west)
  const north = Cesium.Math.toDegrees(rectangle.north)
  const east = Cesium.Math.toDegrees(rectangle.east)

  const params = new URLSearchParams({
    where: `gaz_featureclass='${featureClass}'`,
    geometry: `${west},${south},${east},${north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'gaz_name',
    f: 'json',
    resultRecordCount: '500',
  })

  const res = await fetch(proxied(`${GNIS_LANDFORMS_URL}?${params.toString()}`))
  if (!res.ok) throw new Error(`GNIS request failed: ${res.status}`)
  const data = await res.json()

  const seen = new Set<string>()
  const found: { name: string; lat: number; lon: number }[] = []
  for (const feature of data.features ?? []) {
    const name = feature.attributes?.gaz_name
    const points = feature.geometry?.points
    if (!name || !Array.isArray(points) || points.length === 0) continue
    const [lon, lat] = points[0]
    if (typeof lat !== 'number' || typeof lon !== 'number') continue
    const key = `${name}/${lat.toFixed(3)}/${lon.toFixed(3)}`
    if (seen.has(key)) continue
    seen.add(key)
    found.push({ name, lat, lon })
  }
  return found
}

/** GNIS doesn't include elevation — sample our own already-loaded terrain
 * instead of depending on another source, same approach the weather
 * Graphical tab's landmark sampling uses. */
async function rankByTerrainElevation(
  viewer: Cesium.Viewer,
  kind: 'peak' | 'pass',
  items: { name: string; lat: number; lon: number }[],
): Promise<PlaceLandmark[]> {
  if (items.length === 0) return []
  const cartographics = items.map((s) => Cesium.Cartographic.fromDegrees(s.lon, s.lat))
  const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographics)
  return items.map((s, i) => ({
    id: `${kind}/${s.name}/${s.lat.toFixed(3)}/${s.lon.toFixed(3)}`,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    kind,
    rank: sampled[i]?.height ?? 0,
  }))
}

export async function fetchPlaceLandmarks(viewer: Cesium.Viewer, rectangle: Cesium.Rectangle): Promise<PlaceLandmark[]> {
  const cities = citiesInRectangle(rectangle, 60)
  const [summits, gaps] = await Promise.all([
    fetchGnisFeatures(rectangle, 'Summit'),
    fetchGnisFeatures(rectangle, 'Gap'),
  ])
  const [peaks, passes] = await Promise.all([
    rankByTerrainElevation(viewer, 'peak', summits),
    rankByTerrainElevation(viewer, 'pass', gaps),
  ])

  return [...cities, ...peaks, ...passes]
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
