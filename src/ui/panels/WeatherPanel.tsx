import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import { useCesiumViewer } from '../../cesium/CesiumContext'
import {
  buildTemperatureHeatmapProvider,
  fetchTemperatureSamples,
  temperatureLegendCss,
  TEMPERATURE_LEGEND_RANGE,
  type TemperatureSample,
} from '../../weather/liveTemperature'

const GRID_COLS = 8
const GRID_ROWS = 8

export function WeatherPanel() {
  const viewer = useCesiumViewer()
  const layerRef = useRef<Cesium.ImageryLayer | null>(null)
  const opacityRef = useRef(0.65)

  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [samples, setSamples] = useState<TemperatureSample[]>([])

  useEffect(() => {
    return () => {
      if (viewer && layerRef.current) {
        viewer.imageryLayers.remove(layerRef.current)
      }
    }
  }, [viewer])

  function removeLayer() {
    if (viewer && layerRef.current) {
      viewer.imageryLayers.remove(layerRef.current)
      layerRef.current = null
    }
  }

  async function refresh() {
    if (!viewer) return
    setLoading(true)
    setError(null)
    try {
      const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid)
      if (!rectangle) throw new Error('no view rectangle')

      const found = await fetchTemperatureSamples(rectangle, GRID_COLS, GRID_ROWS)
      if (found.length === 0) {
        setError('No NWS data available here — coverage is the US and territories only.')
        removeLayer()
        setSamples([])
        return
      }

      const provider = await buildTemperatureHeatmapProvider(rectangle, found)
      removeLayer()
      const layer = viewer.imageryLayers.addImageryProvider(provider)
      layer.alpha = opacityRef.current
      layerRef.current = layer
      setSamples(found)
    } catch {
      setError('Could not load live temperature data.')
    } finally {
      setLoading(false)
    }
  }

  function handleToggle(checked: boolean) {
    setEnabled(checked)
    if (checked) {
      refresh()
    } else {
      removeLayer()
      setSamples([])
      setError(null)
    }
  }

  function handleOpacityChange(value: number) {
    opacityRef.current = value
    if (layerRef.current) {
      layerRef.current.alpha = value
    }
  }

  const minTemp = samples.length ? Math.min(...samples.map((s) => s.tempF)) : null
  const maxTemp = samples.length ? Math.max(...samples.map((s) => s.tempF)) : null

  return (
    <div className="panel">
      <h2>Weather</h2>

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!viewer || loading}
          onChange={(e) => handleToggle(e.target.checked)}
        />
        Temperature (live NWS data)
      </label>

      {loading && <p className="empty">Sampling current conditions…</p>}
      {error && <p className="error">{error}</p>}

      {enabled && samples.length > 0 && (
        <div className="weather-controls">
          {minTemp !== null && maxTemp !== null && (
            <p className="empty">
              This view: {Math.round(minTemp)}°F – {Math.round(maxTemp)}°F
            </p>
          )}

          <button onClick={refresh} disabled={loading}>
            Refresh for this view
          </button>

          <div className="slider-row">
            <label htmlFor="temp-opacity">Opacity</label>
            <input
              id="temp-opacity"
              type="range"
              min={0}
              max={1}
              step={0.05}
              defaultValue={opacityRef.current}
              onChange={(e) => handleOpacityChange(Number(e.target.value))}
            />
          </div>

          <div className="legend-row">
            <div className="legend-bar" style={{ background: temperatureLegendCss() }} />
            <div className="legend-labels">
              <span>{TEMPERATURE_LEGEND_RANGE.min}°F</span>
              <span>{TEMPERATURE_LEGEND_RANGE.max}°F</span>
            </div>
          </div>
        </div>
      )}

      <p className="empty">
        Sampled from NOAA's live gridpoint forecast API ({GRID_COLS}×{GRID_ROWS} points across the
        current view) and interpolated. Doesn't follow the camera automatically — use Refresh
        after moving. More elements (wind, sky cover, precipitation) coming later.
      </p>
    </div>
  )
}
