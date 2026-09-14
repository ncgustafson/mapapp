import * as Cesium from 'cesium'
import { proxied } from '../lib/proxy'

export type ElevationBand = {
  label: string
  elevationFt: number
  tempF: number
}

// Standard atmosphere environmental lapse rate — an approximation.
// Real mountain weather (inversions, aspect, exposure) can deviate
// significantly from this, especially in calm/clear conditions.
const LAPSE_RATE_C_PER_M = -0.0065

function metersToFeet(m: number): number {
  return m * 3.28084
}

export async function fetchMountainForecast(
  viewer: Cesium.Viewer,
  lat: number,
  lon: number,
): Promise<{ bands: ElevationBand[] }> {
  const [sampled] = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [
    Cesium.Cartographic.fromDegrees(lon, lat),
  ])
  const summitElevationM = sampled.height ?? 0

  const pointsRes = await fetch(proxied(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`))
  if (!pointsRes.ok) throw new Error('point lookup failed')
  const points = await pointsRes.json()
  const gridUrl: string | undefined = points?.properties?.forecastGridData
  if (!gridUrl) throw new Error('no gridpoint data for this location')

  const gridRes = await fetch(proxied(gridUrl))
  if (!gridRes.ok) throw new Error('gridpoint fetch failed')
  const grid = await gridRes.json()
  const modelElevationM = grid?.properties?.elevation?.value
  const tempValues = grid?.properties?.temperature?.values
  if (typeof modelElevationM !== 'number' || !Array.isArray(tempValues) || tempValues.length === 0) {
    throw new Error('unexpected gridpoint response')
  }
  const modelTempC = tempValues[0].value as number

  function tempAtElevation(elevationM: number): number {
    const celsius = modelTempC + LAPSE_RATE_C_PER_M * (elevationM - modelElevationM)
    return (celsius * 9) / 5 + 32
  }

  const midElevationM = summitElevationM - 500
  const baseElevationM = Math.max(summitElevationM - 1000, 0)

  const bands: ElevationBand[] = [
    { label: 'Summit', elevationFt: metersToFeet(summitElevationM), tempF: tempAtElevation(summitElevationM) },
    { label: 'Mid-mountain', elevationFt: metersToFeet(midElevationM), tempF: tempAtElevation(midElevationM) },
    { label: 'Base', elevationFt: metersToFeet(baseElevationM), tempF: tempAtElevation(baseElevationM) },
  ]

  return { bands }
}
