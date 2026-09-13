import * as Cesium from 'cesium'

export type TemperatureSample = {
  lat: number
  lon: number
  tempF: number
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

function sampleGridPoints(rectangle: Cesium.Rectangle, cols: number, rows: number) {
  const west = Cesium.Math.toDegrees(rectangle.west)
  const east = Cesium.Math.toDegrees(rectangle.east)
  const south = Cesium.Math.toDegrees(rectangle.south)
  const north = Cesium.Math.toDegrees(rectangle.north)

  const points: { lat: number; lon: number }[] = []
  for (let row = 0; row < rows; row++) {
    const lat = south + ((row + 0.5) / rows) * (north - south)
    for (let col = 0; col < cols; col++) {
      const lon = west + ((col + 0.5) / cols) * (east - west)
      points.push({ lat, lon })
    }
  }
  return points
}

export async function fetchTemperatureSamples(
  rectangle: Cesium.Rectangle,
  cols: number,
  rows: number,
): Promise<TemperatureSample[]> {
  const points = sampleGridPoints(rectangle, cols, rows)
  const results = await Promise.all(
    points.map(async (p) => {
      const tempF = await fetchPointTemperatureF(p.lat, p.lon)
      return tempF === null ? null : { ...p, tempF }
    }),
  )
  return results.filter((r): r is TemperatureSample => r !== null)
}

const COLOR_STOPS: { temp: number; color: [number, number, number] }[] = [
  { temp: -10, color: [97, 33, 143] },
  { temp: 0, color: [43, 79, 173] },
  { temp: 20, color: [50, 143, 214] },
  { temp: 32, color: [100, 197, 214] },
  { temp: 45, color: [128, 204, 138] },
  { temp: 60, color: [230, 220, 90] },
  { temp: 75, color: [240, 160, 45] },
  { temp: 90, color: [214, 60, 40] },
  { temp: 105, color: [150, 30, 60] },
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

export function temperatureLegendCss(): string {
  const minT = COLOR_STOPS[0].temp
  const maxT = COLOR_STOPS[COLOR_STOPS.length - 1].temp
  const stops = COLOR_STOPS.map((s) => {
    const pct = ((s.temp - minT) / (maxT - minT)) * 100
    return `rgb(${s.color[0]}, ${s.color[1]}, ${s.color[2]}) ${pct}%`
  })
  return `linear-gradient(to right, ${stops.join(', ')})`
}

export const TEMPERATURE_LEGEND_RANGE = {
  min: COLOR_STOPS[0].temp,
  max: COLOR_STOPS[COLOR_STOPS.length - 1].temp,
}

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

  for (let gy = 0; gy < gridH; gy++) {
    const lat = north - (gy / (gridH - 1)) * (north - south)
    const row: [number, number, number, number][] = []
    for (let gx = 0; gx < gridW; gx++) {
      const lon = west + (gx / (gridW - 1)) * (east - west)
      let weightedTemp = 0
      let weightSum = 0
      for (const s of samples) {
        const d2 = (s.lat - lat) ** 2 + (s.lon - lon) ** 2
        const w = 1 / Math.max(d2, 1e-6)
        weightedTemp += w * s.tempF
        weightSum += w
      }
      const [r, g, b] = colorForTempF(weightedTemp / weightSum)
      row.push([r, g, b, 200])
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
