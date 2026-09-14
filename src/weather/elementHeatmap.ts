import * as Cesium from 'cesium'
import { proxied } from '../lib/proxy'
import type { Landmark } from './landmarks'

export type ElementSample = {
  lat: number
  lon: number
  value: number
  name: string
  kind: 'city' | 'peak'
}

type ColorStop = { value: number; color: [number, number, number] }

type ElementConfig = {
  gridpointField: string
  convert: (raw: number) => number
  unitLabel: string
  colorStops: ColorStop[]
  legendMarks: number[]
  formatValue: (v: number) => string
}

function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32
}

function kmhToMph(k: number): number {
  return k * 0.621371
}

function mmToInches(mm: number): number {
  return mm / 25.4
}

function metersToFeet(m: number): number {
  return m * 3.28084
}

// Mirrors the classic NWS temperature scale used elsewhere in this app.
const TEMP_STOPS: ColorStop[] = [
  { value: -10, color: [70, 20, 90] },
  { value: 0, color: [110, 40, 140] },
  { value: 10, color: [200, 90, 190] },
  { value: 20, color: [140, 70, 200] },
  { value: 30, color: [60, 100, 220] },
  { value: 40, color: [70, 190, 230] },
  { value: 50, color: [80, 190, 150] },
  { value: 60, color: [110, 190, 70] },
  { value: 70, color: [230, 210, 60] },
  { value: 80, color: [235, 140, 40] },
  { value: 90, color: [210, 50, 40] },
  { value: 100, color: [150, 20, 30] },
]

const PERCENT_STOPS: ColorStop[] = [
  { value: 0, color: [255, 255, 255] },
  { value: 25, color: [191, 219, 254] },
  { value: 50, color: [96, 165, 250] },
  { value: 75, color: [37, 99, 235] },
  { value: 100, color: [30, 58, 138] },
]

// Clear (low cover) reads as sky blue, overcast (high cover) as gray.
const SKY_STOPS: ColorStop[] = [
  { value: 0, color: [56, 135, 230] },
  { value: 25, color: [130, 175, 224] },
  { value: 50, color: [176, 184, 204] },
  { value: 75, color: [156, 163, 175] },
  { value: 100, color: [107, 114, 128] },
]

const WIND_STOPS: ColorStop[] = [
  { value: 0, color: [74, 222, 128] },
  { value: 15, color: [250, 204, 21] },
  { value: 30, color: [249, 115, 22] },
  { value: 50, color: [220, 38, 38] },
  { value: 70, color: [127, 29, 29] },
]

function precipStops(max: number): ColorStop[] {
  return [
    { value: 0, color: [240, 249, 255] },
    { value: max * 0.25, color: [186, 230, 253] },
    { value: max * 0.5, color: [56, 189, 248] },
    { value: max * 0.75, color: [59, 130, 246] },
    { value: max, color: [91, 33, 182] },
  ]
}

// Approximate, self-rendered stand-ins for each element — not NOAA's actual
// colors/values, just a reasonable visual for "what's roughly happening
// here" per selected element.
const ELEMENT_CONFIGS: Record<string, ElementConfig> = {
  MaxT: {
    gridpointField: 'maxTemperature',
    convert: celsiusToFahrenheit,
    unitLabel: '°F',
    colorStops: TEMP_STOPS,
    legendMarks: [10, 30, 50, 70, 90],
    formatValue: (v) => `${Math.round(v)}°`,
  },
  MinT: {
    gridpointField: 'minTemperature',
    convert: celsiusToFahrenheit,
    unitLabel: '°F',
    colorStops: TEMP_STOPS,
    legendMarks: [10, 30, 50, 70, 90],
    formatValue: (v) => `${Math.round(v)}°`,
  },
  T: {
    gridpointField: 'temperature',
    convert: celsiusToFahrenheit,
    unitLabel: '°F',
    colorStops: TEMP_STOPS,
    legendMarks: [10, 30, 50, 70, 90],
    formatValue: (v) => `${Math.round(v)}°`,
  },
  ApparentT: {
    gridpointField: 'apparentTemperature',
    convert: celsiusToFahrenheit,
    unitLabel: '°F',
    colorStops: TEMP_STOPS,
    legendMarks: [10, 30, 50, 70, 90],
    formatValue: (v) => `${Math.round(v)}°`,
  },
  Td: {
    gridpointField: 'dewpoint',
    convert: celsiusToFahrenheit,
    unitLabel: '°F',
    colorStops: TEMP_STOPS,
    legendMarks: [10, 30, 50, 70, 90],
    formatValue: (v) => `${Math.round(v)}°`,
  },
  RH: {
    gridpointField: 'relativeHumidity',
    convert: (v) => v,
    unitLabel: '%',
    colorStops: PERCENT_STOPS,
    legendMarks: [0, 25, 50, 75, 100],
    formatValue: (v) => `${Math.round(v)}%`,
  },
  Sky: {
    gridpointField: 'skyCover',
    convert: (v) => v,
    unitLabel: '%',
    colorStops: SKY_STOPS,
    legendMarks: [0, 25, 50, 75, 100],
    formatValue: (v) => `${Math.round(v)}%`,
  },
  PoP12: {
    gridpointField: 'probabilityOfPrecipitation',
    convert: (v) => v,
    unitLabel: '%',
    colorStops: PERCENT_STOPS,
    legendMarks: [0, 25, 50, 75, 100],
    formatValue: (v) => `${Math.round(v)}%`,
  },
  WindSpd: {
    gridpointField: 'windSpeed',
    convert: kmhToMph,
    unitLabel: 'mph',
    colorStops: WIND_STOPS,
    legendMarks: [0, 15, 30, 50, 70],
    formatValue: (v) => `${Math.round(v)}`,
  },
  WindGust: {
    gridpointField: 'windGust',
    convert: kmhToMph,
    unitLabel: 'mph',
    colorStops: WIND_STOPS,
    legendMarks: [0, 15, 30, 50, 70],
    formatValue: (v) => `${Math.round(v)}`,
  },
  QPF: {
    gridpointField: 'quantitativePrecipitation',
    convert: mmToInches,
    unitLabel: 'in',
    colorStops: precipStops(3),
    legendMarks: [0, 0.75, 1.5, 2.25, 3],
    formatValue: (v) => v.toFixed(1),
  },
  SnowAmt: {
    gridpointField: 'snowfallAmount',
    convert: mmToInches,
    unitLabel: 'in',
    colorStops: precipStops(24),
    legendMarks: [0, 6, 12, 18, 24],
    formatValue: (v) => v.toFixed(0),
  },
  IceAccum: {
    gridpointField: 'iceAccumulation',
    convert: mmToInches,
    unitLabel: 'in',
    colorStops: precipStops(1),
    legendMarks: [0, 0.25, 0.5, 0.75, 1],
    formatValue: (v) => v.toFixed(2),
  },
  WaveHeight: {
    gridpointField: 'waveHeight',
    convert: metersToFeet,
    unitLabel: 'ft',
    colorStops: precipStops(20),
    legendMarks: [0, 5, 10, 15, 20],
    formatValue: (v) => `${Math.round(v)}`,
  },
}

export function isElementSupported(code: string): boolean {
  return code in ELEMENT_CONFIGS
}

export function getElementConfig(code: string): ElementConfig | undefined {
  return ELEMENT_CONFIGS[code]
}

async function fetchGridpointValue(lat: number, lon: number, field: string): Promise<number | null> {
  try {
    const pointsRes = await fetch(proxied(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`))
    if (!pointsRes.ok) return null
    const points = await pointsRes.json()
    const gridUrl: string | undefined = points?.properties?.forecastGridData
    if (!gridUrl) return null

    const gridRes = await fetch(proxied(gridUrl))
    if (!gridRes.ok) return null
    const grid = await gridRes.json()
    const values = grid?.properties?.[field]?.values
    if (!Array.isArray(values) || values.length === 0) return null

    const raw = values[0].value
    return typeof raw === 'number' ? raw : null
  } catch {
    return null
  }
}

export async function fetchElementSamples(landmarks: Landmark[], elementCode: string): Promise<ElementSample[]> {
  const config = ELEMENT_CONFIGS[elementCode]
  if (!config) return []

  const results = await Promise.all(
    landmarks.map(async (landmark) => {
      const raw = await fetchGridpointValue(landmark.lat, landmark.lon, config.gridpointField)
      if (raw === null) return null
      return {
        lat: landmark.lat,
        lon: landmark.lon,
        value: config.convert(raw),
        name: landmark.name,
        kind: landmark.kind,
      }
    }),
  )
  return results.filter((r): r is ElementSample => r !== null)
}

function colorForValue(stops: ColorStop[], value: number): [number, number, number] {
  if (value <= stops[0].value) return stops[0].color
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (value >= a.value && value <= b.value) {
      const t = (value - a.value) / (b.value - a.value)
      return [
        a.color[0] + (b.color[0] - a.color[0]) * t,
        a.color[1] + (b.color[1] - a.color[1]) * t,
        a.color[2] + (b.color[2] - a.color[2]) * t,
      ]
    }
  }
  return stops[stops.length - 1].color
}

export function rgbStringForValue(elementCode: string, value: number): string {
  const config = ELEMENT_CONFIGS[elementCode]
  if (!config) return 'rgb(128,128,128)'
  const [r, g, b] = colorForValue(config.colorStops, value)
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
}

function renderHeatmapCanvas(
  samples: ElementSample[],
  stops: ColorStop[],
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

  const gridW = Math.min(width, 96)
  const gridH = Math.min(height, 96)
  const grid: [number, number, number, number][][] = []

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
      let weightedValue = 0
      let weightSum = 0
      for (const s of samples) {
        const dist = Math.hypot(s.lat - lat, s.lon - lon)
        const w = 1 / Math.max(dist ** 3, 1e-9)
        weightedValue += w * s.value
        weightSum += w
      }
      const [r, g, b] = colorForValue(stops, weightedValue / weightSum)
      const alpha = Math.round(200 * edgeFade(u, v))
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

export async function buildElementHeatmapProvider(
  rectangle: Cesium.Rectangle,
  samples: ElementSample[],
  elementCode: string,
): Promise<Cesium.SingleTileImageryProvider | null> {
  const config = ELEMENT_CONFIGS[elementCode]
  if (!config) return null
  const canvas = renderHeatmapCanvas(samples, config.colorStops, rectangle, 512, 512)
  const dataUrl = canvas.toDataURL('image/png')
  return Cesium.SingleTileImageryProvider.fromUrl(dataUrl, { rectangle })
}
