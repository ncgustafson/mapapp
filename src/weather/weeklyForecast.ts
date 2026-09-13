export type DailyPeriod = {
  name: string
  tempF: number
  isDaytime: boolean
  shortForecast: string
  windSpeed: string
  windDirection: string
}

export async function fetchWeeklyForecast(lat: number, lon: number): Promise<DailyPeriod[]> {
  const pointsRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`)
  if (!pointsRes.ok) throw new Error('point lookup failed')
  const points = await pointsRes.json()
  const forecastUrl: string | undefined = points?.properties?.forecast
  if (!forecastUrl) throw new Error('no forecast available for this location')

  const res = await fetch(forecastUrl)
  if (!res.ok) throw new Error('forecast fetch failed')
  const data = await res.json()
  const periods = data?.properties?.periods
  if (!Array.isArray(periods)) throw new Error('unexpected forecast response')

  return periods.map((p: any) => ({
    name: p.name,
    tempF: p.temperature,
    isDaytime: p.isDaytime,
    shortForecast: p.shortForecast,
    windSpeed: p.windSpeed,
    windDirection: p.windDirection,
  }))
}
