import { useState } from 'react'
import { useCesiumViewer } from '../../../cesium/CesiumContext'
import { getMapCenter } from '../../../cesium/mapCenter'
import { fetchWeeklyForecast, type DailyPeriod } from '../../../weather/weeklyForecast'

export function WeeklyTab() {
  const viewer = useCesiumViewer()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [periods, setPeriods] = useState<DailyPeriod[]>([])

  async function refresh() {
    if (!viewer) return
    setLoading(true)
    setError(null)
    try {
      const center = getMapCenter(viewer)
      if (!center) throw new Error('no map center')
      const found = await fetchWeeklyForecast(center.lat, center.lon)
      setPeriods(found)
    } catch {
      setError('Could not load a forecast here — coverage is the US and territories only.')
      setPeriods([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="weather-controls">
      <button onClick={refresh} disabled={!viewer || loading}>
        {loading ? 'Loading…' : 'Get forecast for map center'}
      </button>

      {error && <p className="error">{error}</p>}

      {periods.length > 0 && (
        <ul className="forecast-list">
          {periods.map((p, i) => (
            <li key={i} className="forecast-row">
              <span className="forecast-name">{p.name}</span>
              <span className="forecast-temp">{Math.round(p.tempF)}°</span>
              <span className="forecast-desc">{p.shortForecast}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="empty">NOAA's 7-day point forecast for whatever the map is currently centered on.</p>
    </div>
  )
}
