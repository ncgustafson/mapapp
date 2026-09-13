export type WeatherModel = { id: string; label: string }

export const MODEL_LIST: WeatherModel[] = [
  { id: 'gfs_seamless', label: 'GFS (NOAA)' },
  { id: 'ecmwf_ifs025', label: 'ECMWF' },
  { id: 'icon_seamless', label: 'ICON (DWD)' },
  { id: 'gem_seamless', label: 'GEM (Canada)' },
  { id: 'jma_seamless', label: 'JMA (Japan)' },
]

export type ModelForecastPoint = {
  time: string
  valuesByModel: Record<string, number | null>
}

export async function fetchModelComparison(lat: number, lon: number): Promise<ModelForecastPoint[]> {
  const modelIds = MODEL_LIST.map((m) => m.id).join(',')
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=temperature_2m&temperature_unit=fahrenheit&models=${modelIds}&forecast_days=3&timezone=auto`

  const res = await fetch(url)
  if (!res.ok) throw new Error('model comparison fetch failed')
  const data = await res.json()

  const times: string[] = data?.hourly?.time ?? []
  if (times.length === 0) throw new Error('unexpected model comparison response')

  return times.map((time, i) => {
    const valuesByModel: Record<string, number | null> = {}
    for (const model of MODEL_LIST) {
      const series = data.hourly[`temperature_2m_${model.id}`]
      valuesByModel[model.id] = Array.isArray(series) && series[i] != null ? series[i] : null
    }
    return { time, valuesByModel }
  })
}
