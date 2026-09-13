import * as Cesium from 'cesium'
import type { Landmark } from './landmarks'

export type TemperatureSample = {
  lat: number
  lon: number
  tempF: number
  name: string
  kind: 'city' | 'peak'
}

async function fetchPointTemperatureF(lat: number, lon: number): Promise<number | null> {
  try {
    const pointsRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`)
    if (!pointsRes.ok) return null
    const points = await pointsRes.json()
    const gridUrl: string | undefined = points?.properties?.forecastGridData
    if (!gridUrl) return null

    const gridRes = await fetch(gridUrl)
    if (!gridRes.ok) return null
    const grid = await gridRes.json()
    const values = grid?.properties?.temperature?.values
    if (!Array.isArray(values) || values.length === 0) return null

    const celsius = values[0].value
    if (typeof celsius !== 'number') return null
    return (celsius * 9) / 5 + 32
  } catch {
    return null
  }
}

export async function fetchTemperatureForLandmarks(landmarks: Landmark[]): Promise<TemperatureSample[]> {
  const results = await Promise.all(
    landmarks.map(async (landmark) => {
      const tempF = await fetchPointTemperatureF(landmark.lat, landmark.lon)
      if (tempF === null) return null
      return { lat: landmark.lat, lon: landmark.lon, tempF, name: landmark.name, kind: landmark.kind }
    }),
  )
  return results.filter((r): r is TemperatureSample => r !== null)
}

// Mirrors the classic NWS graphical-forecast temperature scale
// (magenta/purple cold through blue, green, yellow, to red hot),
// anchored at clean 10-degree marks like the reference product.
const COLOR_STOPS: { temp: number; color: [number, number, number] }[] = [
  { temp: -10, color: [70, 20, 90] },
  { temp: 0, color: [110, 40, 140] },
  { temp: 10, color: [200, 90, 190] },
  { temp: 20, color: [140, 70, 200] },
  { temp: 30, color: [60, 100, 220] },
  { temp: 40, color: [70, 190, 230] },
  { temp: 50, color: [80, 190, 150] },
  { temp: 60, color: [110, 190, 70] },
  { temp: 70, color: [230, 210, 60] },
  { temp: 80, color: [235, 140, 40] },
  { temp: 90, color: [210, 50, 40] },
  { temp: 100, color: [150, 20, 30] },
]

function colorForTempF(tempF: number): [number, number, number] {
  if (tempF <= COLOR_STOPS[0].temp) return COLOR_STOPS[0].color
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i]
    const b = COLOR_STOPS[i + 1]
    if (tempF >= a.temp && tempF <= b.temp) {
      const t = (tempF - a.temp) / (b.temp - a.temp)
      return [
        a.color[0] + (b.color[0] - a.color[0]) * t,
        a.color[1] + (b.color[1] - a.color[1]) * t,
        a.color[2] + (b.color[2] - a.color[2]) * t,
      ]
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1].color
}

export function rgbStringForTempF(tempF: number): string {
  const [r, g, b] = colorForTempF(tempF)
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
}

/** The 10-90 marks shown on the legend, matching the reference scale. */
export const TEMPERATURE_LEGEND_MARKS = [10, 20, 30, 40, 50, 60, 70, 80, 90]

function renderHeatmapCanvas(
  samples: TemperatureSample[],
  rectangle: Cesium.Rectangle,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const imageData = ctx.createImageData(width, height)

  const west = Cesium.Math.toDegrees(rectangle.west)
  const east = Cesium.Math.toDegrees(rectangle.east)
  const south = Cesium.Math.toDegrees(rectangle.south)
  const north = Cesium.Math.toDegrees(rectangle.north)

  // Interpolate on a coarser grid for performance; the canvas's own
  // scaling smooths it out to full resolution.
  const gridW = Math.min(width, 96)
  const gridH = Math.min(height, 96)
  const grid: [number, number, number, number][][] = []

  // Fade alpha out near the tile's edges so the overlay blends into the
  // surrounding terrain instead of ending in a hard rectangular cutoff.
  const edgeMargin = 0.12
  function smoothstep(edge0: number, edge1: number, x: number) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
  }
  function edgeFade(u: number, v: number) {
    return (
      smoothstep(0, edgeMargin, u) *
      smoothstep(0, edgeMargin, 1 - u) *
      smoothstep(0, edgeMargin, v) *
      smoothstep(0, edgeMargin, 1 - v)
    )
  }

  for (let gy = 0; gy < gridH; gy++) {
    const v = gy / (gridH - 1)
    const lat = north - v * (north - south)
    const row: [number, number, number, number][] = []
    for (let gx = 0; gx < gridW; gx++) {
      const u = gx / (gridW - 1)
      const lon = west + u * (east - west)
      let weightedTemp = 0
      let weightSum = 0
      for (const s of samples) {
        const dist = Math.hypot(s.lat - lat, s.lon - lon)
        const w = 1 / Math.max(dist ** 3, 1e-9)
        weightedTemp += w * s.tempF
        weightSum += w
      }
      const [r, g, b] = colorForTempF(weightedTemp / weightSum)
      const alpha = Math.round(210 * edgeFade(u, v))
      row.push([r, g, b, alpha])
    }
    grid.push(row)
  }

  for (let y = 0; y < height; y++) {
    const gy = Math.min(gridH - 1, Math.floor((y / height) * gridH))
    for (let x = 0; x < width; x++) {
      const gx = Math.min(gridW - 1, Math.floor((x / width) * gridW))
      const [r, g, b, a] = grid[gy][gx]
      const idx = (y * width + x) * 4
      imageData.data[idx] = r
      imageData.data[idx + 1] = g
      imageData.data[idx + 2] = b
      imageData.data[idx + 3] = a
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas
}

export async function buildTemperatureHeatmapProvider(
  rectangle: Cesium.Rectangle,
  samples: TemperatureSample[],
): Promise<Cesium.SingleTileImageryProvider> {
  const canvas = renderHeatmapCanvas(samples, rectangle, 512, 512)
  const dataUrl = canvas.toDataURL('image/png')
  return Cesium.SingleTileImageryProvider.fromUrl(dataUrl, { rectangle })
}
