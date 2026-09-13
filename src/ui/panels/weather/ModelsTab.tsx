import { useState } from 'react'
import { useCesiumViewer } from '../../../cesium/CesiumContext'
import { getMapCenter } from '../../../cesium/mapCenter'
import { fetchModelComparison, MODEL_LIST, type ModelForecastPoint } from '../../../weather/modelComparison'

export function ModelsTab() {
  const viewer = useCesiumViewer()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [points, setPoints] = useState<ModelForecastPoint[]>([])

  async function refresh() {
    if (!viewer) return
    setLoading(true)
    setError(null)
    try {
      const center = getMapCenter(viewer)
      if (!center) throw new Error('no map center')
      const found = await fetchModelComparison(center.lat, center.lon)
      setPoints(found)
    } catch {
      setError('Could not load model comparison data.')
      setPoints([])
    } finally {
      setLoading(false)
    }
  }

  // 3 days of hourly data is too dense for a compact table — thin to every 6 hours.
  const rows = points.filter((_, i) => i % 6 === 0)

  return (
    <div className="weather-controls">
      <button onClick={refresh} disabled={!viewer || loading}>
        {loading ? 'Loading…' : 'Compare models at map center'}
      </button>

      {error && <p className="error">{error}</p>}

      {rows.length > 0 && (
        <div className="model-table-wrap">
          <table className="model-table">
            <thead>
              <tr>
                <th>Time</th>
                {MODEL_LIST.map((m) => (
                  <th key={m.id}>{m.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.time}>
                  <td>{new Date(row.time).toLocaleString(undefined, { weekday: 'short', hour: 'numeric' })}</td>
                  {MODEL_LIST.map((m) => {
                    const v = row.valuesByModel[m.id]
                    return <td key={m.id}>{v !== null ? `${Math.round(v)}°` : '—'}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="empty">
        Temperature from several independent weather models (GFS, ECMWF, ICON, GEM, JMA) for the
        map center, via Open-Meteo — compare where models agree or diverge.
      </p>
    </div>
  )
}
