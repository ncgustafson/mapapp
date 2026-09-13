import * as Cesium from 'cesium'

export type Landmark = {
  name: string
  lat: number
  lon: number
  kind: 'city' | 'peak'
  rank: number // population for cities, elevation in meters for peaks
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

// Regional-scale views only — a whole-continent query would return an
// unbounded number of towns/peaks and likely time out.
const MAX_VIEW_AREA_DEG2 = 25

export async function fetchLandmarks(
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

  const query = `[out:json][timeout:25];(node["place"~"^(city|town)$"]["population"](${south},${west},${north},${east});node["natural"="peak"]["name"](${south},${west},${north},${east}););out body;`

  const res = await fetch(OVERPASS_URL, { method: 'POST', body: query })
  if (!res.ok) throw new Error(`Overpass request failed: ${res.status}`)
  const data = await res.json()

  const cities: Landmark[] = []
  const peaks: Landmark[] = []

  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {}
    if (!tags.name || typeof el.lat !== 'number' || typeof el.lon !== 'number') continue

    if (tags.place === 'city' || tags.place === 'town') {
      const population = Number(tags.population)
      if (!Number.isFinite(population)) continue
      cities.push({ name: tags.name, lat: el.lat, lon: el.lon, kind: 'city', rank: population })
    } else if (tags.natural === 'peak') {
      const elevation = Number(tags.ele)
      peaks.push({
        name: tags.name,
        lat: el.lat,
        lon: el.lon,
        kind: 'peak',
        rank: Number.isFinite(elevation) ? elevation : 0,
      })
    }
  }

  cities.sort((a, b) => b.rank - a.rank)
  peaks.sort((a, b) => b.rank - a.rank)

  return [...cities.slice(0, maxCities), ...peaks.slice(0, maxPeaks)]
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
