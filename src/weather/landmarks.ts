import * as Cesium from 'cesium'
import { proxied } from '../lib/proxy'
import usCitiesData from '../places/data/us_cities.json'

export type Landmark = {
  name: string
  lat: number
  lon: number
  kind: 'city' | 'peak'
  rank: number // population for cities, elevation in meters for peaks
}

type UsCity = { name: string; lat: number; lon: number; population: number; state: string }
const US_CITIES = usCitiesData as UsCity[]

// USGS's National Map hosts GNIS (the official US database of named
// geographic features) as a live, public, no-key ArcGIS REST service —
// far more reliable than Overpass's community demo server for this kind
// of always-available lookup.
const GNIS_LANDFORMS_URL = 'https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer/5/query'

// Regional-scale views only — a whole-continent query would return an
// unbounded number of peaks and likely time out.
const MAX_VIEW_AREA_DEG2 = 25

function citiesInRectangle(rectangle: Cesium.Rectangle, maxCities: number): Landmark[] {
  const south = Cesium.Math.toDegrees(rectangle.south)
  const west = Cesium.Math.toDegrees(rectangle.west)
  const north = Cesium.Math.toDegrees(rectangle.north)
  const east = Cesium.Math.toDegrees(rectangle.east)

  return US_CITIES.filter((c) => c.lat >= south && c.lat <= north && c.lon >= west && c.lon <= east)
    .sort((a, b) => b.population - a.population)
    .slice(0, maxCities)
    .map((c) => ({ name: c.name, lat: c.lat, lon: c.lon, kind: 'city' as const, rank: c.population }))
}

async function fetchGnisSummits(rectangle: Cesium.Rectangle): Promise<{ name: string; lat: number; lon: number }[]> {
  const south = Cesium.Math.toDegrees(rectangle.south)
  const west = Cesium.Math.toDegrees(rectangle.west)
  const north = Cesium.Math.toDegrees(rectangle.north)
  const east = Cesium.Math.toDegrees(rectangle.east)

  const params = new URLSearchParams({
    where: "gaz_featureclass='Summit'",
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
  const summits: { name: string; lat: number; lon: number }[] = []
  for (const feature of data.features ?? []) {
    const name = feature.attributes?.gaz_name
    const points = feature.geometry?.points
    if (!name || !Array.isArray(points) || points.length === 0) continue
    const [lon, lat] = points[0]
    if (typeof lat !== 'number' || typeof lon !== 'number') continue
    const key = `${name}/${lat.toFixed(3)}/${lon.toFixed(3)}`
    if (seen.has(key)) continue
    seen.add(key)
    summits.push({ name, lat, lon })
  }
  return summits
}

/** Elevation is rank data for peaks, but GNIS doesn't include it — sample
 * our own already-loaded terrain instead of depending on another source. */
async function rankPeaksByTerrainElevation(
  viewer: Cesium.Viewer,
  summits: { name: string; lat: number; lon: number }[],
): Promise<Landmark[]> {
  if (summits.length === 0) return []
  const cartographics = summits.map((s) => Cesium.Cartographic.fromDegrees(s.lon, s.lat))
  const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographics)
  return summits.map((s, i) => ({
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    kind: 'peak' as const,
    rank: sampled[i]?.height ?? 0,
  }))
}

export async function fetchLandmarks(
  viewer: Cesium.Viewer,
  rectangle: Cesium.Rectangle,
  // Generous candidate pools — final on-screen selection happens later via
  // declutterByScreenSpace, which needs enough options to choose from.
  maxCities = 40,
  maxPeaks = 30,
): Promise<Landmark[]> {
  const south = Cesium.Math.toDegrees(rectangle.south)
  const west = Cesium.Math.toDegrees(rectangle.west)
  const north = Cesium.Math.toDegrees(rectangle.north)
  const east = Cesium.Math.toDegrees(rectangle.east)

  const area = (north - south) * (east - west)
  if (area > MAX_VIEW_AREA_DEG2) {
    throw new Error('view too large — zoom in for landmark data')
  }

  const cities = citiesInRectangle(rectangle, maxCities)
  const summits = await fetchGnisSummits(rectangle)
  const peaks = (await rankPeaksByTerrainElevation(viewer, summits))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, maxPeaks)

  return [...cities, ...peaks]
}

function projectToScreen(viewer: Cesium.Viewer, lat: number, lon: number): Cesium.Cartesian2 | undefined {
  const cartesian = Cesium.Cartesian3.fromDegrees(lon, lat)
  return Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, cartesian)
}

/**
 * Picks which landmarks to actually show, enforcing a minimum on-screen
 * pixel distance between labels. Degree-based distance doesn't work here —
 * at oblique or high-altitude camera angles, a tiny lat/lon difference can
 * span a huge screen distance (or the reverse), so decluttering has to
 * happen in screen space using the current camera projection.
 */
export function declutterByScreenSpace(
  viewer: Cesium.Viewer,
  groups: { items: Landmark[]; maxCount: number }[],
  minPixelDistance = 70,
): Landmark[] {
  const canvas = viewer.scene.canvas
  const chosenPositions: Cesium.Cartesian2[] = []
  const result: Landmark[] = []

  for (const group of groups) {
    let count = 0
    for (const landmark of group.items) {
      if (count >= group.maxCount) break
      const pos = projectToScreen(viewer, landmark.lat, landmark.lon)
      if (!pos) continue
      if (pos.x < 0 || pos.y < 0 || pos.x > canvas.clientWidth || pos.y > canvas.clientHeight) continue

      const tooClose = chosenPositions.some((p) => Cesium.Cartesian2.distance(p, pos) < minPixelDistance)
      if (tooClose) continue

      chosenPositions.push(pos)
      result.push(landmark)
      count++
    }
  }

  return result
}
