import { useState } from 'react'
import { useCesiumViewer } from '../../../cesium/CesiumContext'
import { getMapCenter } from '../../../cesium/mapCenter'
import { fetchMountainForecast, type ElevationBand } from '../../../weather/mountainForecast'

export function MountainTab() {
  const viewer = useCesiumViewer()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bands, setBands] = useState<ElevationBand[]>([])

  async function refresh() {
    if (!viewer) return
    setLoading(true)
    setError(null)
    try {
      const center = getMapCenter(viewer)
      if (!center) throw new Error('no map center')
      const result = await fetchMountainForecast(viewer, center.lat, center.lon)
      setBands(result.bands)
    } catch {
      setError('Could not build an elevation forecast here — coverage is the US and territories only.')
      setBands([])
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

      {bands.length > 0 && (
        <ul className="forecast-list">
          {bands.map((b) => (
            <li key={b.label} className="forecast-row">
              <span className="forecast-name">{b.label}</span>
              <span className="forecast-temp">{Math.round(b.tempF)}°</span>
              <span className="forecast-desc">{Math.round(b.elevationFt).toLocaleString()} ft</span>
            </li>
          ))}
        </ul>
      )}

      <p className="empty">
        Estimates temperature at summit / mid-mountain / base using the real terrain elevation at
        the map center and a standard lapse rate applied to NOAA's forecast. An approximation —
        not an official per-elevation model, and doesn't account for inversions or aspect.
      </p>
    </div>
  )
}
