import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import { useCesiumViewer } from '../../cesium/CesiumContext'
import { declutterByScreenSpace, fetchLandmarks } from '../../weather/landmarks'
import {
  buildTemperatureHeatmapProvider,
  fetchTemperatureForLandmarks,
  rgbStringForTempF,
  TEMPERATURE_LEGEND_MARKS,
  type TemperatureSample,
} from '../../weather/liveTemperature'

function buildLabelEntities(samples: TemperatureSample[]): Cesium.Entity[] {
  return samples.map(
    (s) =>
      new Cesium.Entity({
        position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat),
        label: {
          text: `${s.name}\n${Math.round(s.tempF)}°`,
          font: 'bold 13px system-ui, sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        point: {
          pixelSize: s.kind === 'peak' ? 6 : 8,
          color: s.kind === 'peak' ? Cesium.Color.SADDLEBROWN : Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
  )
}

export function WeatherPanel() {
  const viewer = useCesiumViewer()
  const layerRef = useRef<Cesium.ImageryLayer | null>(null)
  const labelEntitiesRef = useRef<Cesium.Entity[]>([])
  const opacityRef = useRef(0.6)
  const requestIdRef = useRef(0)

  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [samples, setSamples] = useState<TemperatureSample[]>([])

  useEffect(() => {
    return () => {
      removeLayer()
      removeLabels()
    }
  }, [viewer])

  function removeLayer() {
    if (viewer && layerRef.current) {
      viewer.imageryLayers.remove(layerRef.current)
      layerRef.current = null
    }
  }

  function removeLabels() {
    if (viewer) {
      for (const entity of labelEntitiesRef.current) {
        viewer.entities.remove(entity)
      }
    }
    labelEntitiesRef.current = []
  }

  async function refresh() {
    if (!viewer) return
    const requestId = ++requestIdRef.current
    const isStale = () => requestIdRef.current !== requestId

    setLoading(true)
    setError(null)
    try {
      const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid)
      if (!rectangle) throw new Error('no view rectangle')

      const candidates = await fetchLandmarks(rectangle)
      if (isStale()) return

      const landmarks = declutterByScreenSpace(viewer, [
        { items: candidates.filter((l) => l.kind === 'city'), maxCount: 12 },
        { items: candidates.filter((l) => l.kind === 'peak'), maxCount: 8 },
      ])
      if (landmarks.length < 3) {
        setError('Not enough named cities or peaks found in this view to build an overlay.')
        removeLayer()
        removeLabels()
        setSamples([])
        return
      }

      const found = await fetchTemperatureForLandmarks(landmarks)
      if (isStale()) return
      if (found.length === 0) {
        setError('No NWS data available here — coverage is the US and territories only.')
        removeLayer()
        removeLabels()
        setSamples([])
        return
      }

      const provider = await buildTemperatureHeatmapProvider(rectangle, found)
      if (isStale()) return

      removeLayer()
      removeLabels()
      const layer = viewer.imageryLayers.addImageryProvider(provider)
      layer.alpha = opacityRef.current
      layerRef.current = layer

      const labels = buildLabelEntities(found)
      for (const entity of labels) viewer.entities.add(entity)
      labelEntitiesRef.current = labels

      setSamples(found)
    } catch (e) {
      if (isStale()) return
      setError(
        e instanceof Error && e.message.includes('too large')
          ? 'Zoom in closer to sample landmark temperatures for this area.'
          : 'Could not load live temperature data.',
      )
    } finally {
      if (!isStale()) setLoading(false)
    }
  }

  function handleToggle(checked: boolean) {
    setEnabled(checked)
    if (checked) {
      refresh()
    } else {
      removeLayer()
      removeLabels()
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
  const cityCount = samples.filter((s) => s.kind === 'city').length
  const peakCount = samples.filter((s) => s.kind === 'peak').length

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

      {loading && <p className="empty">Finding landmarks and sampling conditions…</p>}
      {error && <p className="error">{error}</p>}

      {enabled && samples.length > 0 && (
        <div className="weather-controls">
          {minTemp !== null && maxTemp !== null && (
            <p className="empty">
              {cityCount} cities, {peakCount} peaks — {Math.round(minTemp)}°F – {Math.round(maxTemp)}°F
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

          <div className="legend-scale">
            {TEMPERATURE_LEGEND_MARKS.map((mark) => (
              <div key={mark} className="legend-swatch" style={{ background: rgbStringForTempF(mark) }}>
                {mark}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="empty">
        Samples named cities and peaks (via OpenStreetMap) in the current view, then pulls live
        temperature from NOAA's gridpoint forecast API for each. Regional-scale views only — zoom
        in if it can't find enough landmarks. Doesn't follow the camera automatically — use
        Refresh after moving. More elements (wind, sky cover, precipitation) coming later.
      </p>
    </div>
  )
}
