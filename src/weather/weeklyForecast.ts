export type DailyPeriod = {
  name: string
  tempF: number
  isDaytime: boolean
  shortForecast: string
  detailedForecast: string
  precipChance: number | null
  iconUrl: string
  windSpeed: string
  windDirection: string
}

export type WeeklyForecastResult = {
  city: string | null
  state: string | null
  periods: DailyPeriod[]
}

export async function fetchWeeklyForecast(lat: number, lon: number): Promise<WeeklyForecastResult> {
  const pointsRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`)
  if (!pointsRes.ok) throw new Error('point lookup failed')
  const points = await pointsRes.json()
  const forecastUrl: string | undefined = points?.properties?.forecast
  if (!forecastUrl) throw new Error('no forecast available for this location')
  const relativeLocation = points?.properties?.relativeLocation?.properties

  const res = await fetch(forecastUrl)
  if (!res.ok) throw new Error('forecast fetch failed')
  const data = await res.json()
  const periods = data?.properties?.periods
  if (!Array.isArray(periods)) throw new Error('unexpected forecast response')

  return {
    city: relativeLocation?.city ?? null,
    state: relativeLocation?.state ?? null,
    periods: periods.map((p: any) => ({
      name: p.name,
      tempF: p.temperature,
      isDaytime: p.isDaytime,
      shortForecast: p.shortForecast,
      detailedForecast: p.detailedForecast,
      precipChance: p.probabilityOfPrecipitation?.value ?? null,
      iconUrl: p.icon,
      windSpeed: p.windSpeed,
      windDirection: p.windDirection,
    })),
  }
}
