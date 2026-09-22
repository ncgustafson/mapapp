import * as Cesium from 'cesium'

export type RouteKind = 'line' | 'point' | 'polygon'
export type LatLon = { lat: number; lon: number }

export type RouteFeature = {
  id: string
  kind: RouteKind
  name: string
  points: LatLon[]
  /** Total path length in meters. Undefined for points. */
  distanceMeters?: number
  /** Terrain-sampled climb/descent along the path, in meters. Undefined for points. */
  elevationGainMeters?: number
  elevationLossMeters?: number
  /** Whether this is currently drawn on the map. Defaults to true — older
   * saved routes from before this field existed load as visible. */
  visible?: boolean
}

export const KIND_COLORS: Record<RouteKind, string> = {
  line: '#3b82f6',
  point: '#f87171',
  polygon: '#f59e0b',
}

const STORAGE_KEY = 'mapapp.routes'

export function loadRoutes(): RouteFeature[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function persistRoutes(routes: RouteFeature[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(routes))
  } catch {
    // localStorage unavailable (e.g. private browsing) — saves just won't persist
  }
}

/** Real geodesic distance along the path (great-circle per segment, not straight-line end to end). */
export function pathDistanceMeters(points: LatLon[], closed: boolean): number {
  const path = closed ? [...points, points[0]] : points
  let total = 0
  for (let i = 1; i < path.length; i++) {
    const geodesic = new Cesium.EllipsoidGeodesic(
      Cesium.Cartographic.fromDegrees(path[i - 1].lon, path[i - 1].lat),
      Cesium.Cartographic.fromDegrees(path[i].lon, path[i].lat),
    )
    total += geodesic.surfaceDistance
  }
  return total
}

/**
 * Climb/descent along the path, sampled at each vertex (not densely
 * resampled between them) — a reasonable approximation for a manually
 * clicked route without the cost of a full elevation profile.
 */
export async function pathElevationGainLoss(
  viewer: Cesium.Viewer,
  points: LatLon[],
  closed: boolean,
): Promise<{ gain: number; loss: number }> {
  const path = closed ? [...points, points[0]] : points
  const cartographics = path.map((p) => Cesium.Cartographic.fromDegrees(p.lon, p.lat))
  const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographics)

  let gain = 0
  let loss = 0
  for (let i = 1; i < sampled.length; i++) {
    const delta = (sampled[i].height ?? 0) - (sampled[i - 1].height ?? 0)
    if (delta > 0) gain += delta
    else loss += -delta
  }
  return { gain, loss }
}

export type ElevationProfilePoint = { distanceMeters: number; elevationMeters: number }

const PROFILE_SAMPLE_COUNT = 150

/**
 * Elevation vs. distance along the path, resampled at evenly spaced
 * distances (not just at the route's own vertices — those can be sparse in
 * unsnapped/fallback segments and dense elsewhere from trail-tracing, which
 * would skew a profile chart) using real terrain height at each sample.
 */
export async function pathElevationProfile(
  viewer: Cesium.Viewer,
  points: LatLon[],
  closed: boolean,
): Promise<ElevationProfilePoint[]> {
  const path = closed ? [...points, points[0]] : points
  if (path.length < 2) return []

  const geodesics = path
    .slice(1)
    .map(
      (p, i) =>
        new Cesium.EllipsoidGeodesic(
          Cesium.Cartographic.fromDegrees(path[i].lon, path[i].lat),
          Cesium.Cartographic.fromDegrees(p.lon, p.lat),
        ),
    )
  const segmentLengths = geodesics.map((g) => g.surfaceDistance)
  const totalDistance = segmentLengths.reduce((a, b) => a + b, 0)
  if (totalDistance === 0) return []

  const cartographics: Cesium.Cartographic[] = []
  const distances: number[] = []
  for (let s = 0; s < PROFILE_SAMPLE_COUNT; s++) {
    const targetDistance = (s / (PROFILE_SAMPLE_COUNT - 1)) * totalDistance
    let segIndex = 0
    let distanceBeforeSeg = 0
    while (segIndex < segmentLengths.length - 1 && distanceBeforeSeg + segmentLengths[segIndex] < targetDistance) {
      distanceBeforeSeg += segmentLengths[segIndex]
      segIndex++
    }
    const segLength = segmentLengths[segIndex] ?? 0
    const distanceIntoSeg = Math.min(Math.max(targetDistance - distanceBeforeSeg, 0), segLength)
    cartographics.push(
      segLength > 0
        ? geodesics[segIndex].interpolateUsingSurfaceDistance(distanceIntoSeg)
        : Cesium.Cartographic.fromDegrees(path[segIndex].lon, path[segIndex].lat),
    )
    distances.push(targetDistance)
  }

  const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographics)
  return sampled.map((c, i) => ({ distanceMeters: distances[i], elevationMeters: c.height ?? 0 }))
}

export function formatDistance(meters: number): string {
  const miles = meters / 1609.344
  return miles >= 0.1 ? `${miles.toFixed(2)} mi` : `${Math.round(meters)} m`
}

export function formatElevation(meters: number): string {
  return `${Math.round(meters * 3.28084)} ft`
}
