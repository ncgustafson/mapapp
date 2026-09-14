import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import { useCesiumViewer } from '../../../cesium/CesiumContext'
import { getMapCenter } from '../../../cesium/mapCenter'
import { addTerrainBoundsBorder } from '../../../cesium/markers'
import {
  findStateSectorForPoint,
  GRAPHICAL_ELEMENTS,
  GRAPHICAL_REGIONS,
  GRAPHICAL_SECTOR_BOUNDS,
  GRAPHICAL_STATES,
  graphicalImageUrl,
  periodDateLabel,
} from '../../../weather/graphicalForecast'
import { declutterByScreenSpace, fetchLandmarks } from '../../../weather/landmarks'
import {
  buildElementHeatmapProvider,
  fetchElementSamples,
  getElementConfig,
  isElementSupported,
  rgbStringForValue,
  type ElementSample,
} from '../../../weather/elementHeatmap'

const ALL_SECTORS = [...GRAPHICAL_REGIONS, ...GRAPHICAL_STATES]

function buildOverlayLabelEntities(samples: ElementSample[], elementCode: string): Cesium.Entity[] {
  const config = getElementConfig(elementCode)
  return samples.map(
    (s) =>
      new Cesium.Entity({
        position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat),
        label: {
          text: `${s.name}\n${config ? config.formatValue(s.value) : Math.round(s.value)}`,
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

export function GraphicalTab() {
  const viewer = useCesiumViewer()
  const suppressNextMoveEndRef = useRef(false)
  const sectorRef = useRef('washington')

  const overlayLayerRef = useRef<Cesium.ImageryLayer | null>(null)
  const overlayLabelsRef = useRef<Cesium.Entity[]>([])
  const overlayOpacityRef = useRef(0.65)
  const overlayRequestIdRef = useRef(0)

  const [sector, setSector] = useState('washington')
  const [elementCode, setElementCode] = useState('MaxT')
  const [period, setPeriod] = useState(1)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  const [overlayEnabled, setOverlayEnabled] = useState(false)
  const [overlayLoading, setOverlayLoading] = useState(false)
  const [overlayError, setOverlayError] = useState<string | null>(null)
  const [overlaySamples, setOverlaySamples] = useState<ElementSample[]>([])

  const element = GRAPHICAL_ELEMENTS.find((e) => e.code === elementCode) ?? GRAPHICAL_ELEMENTS[0]
  const overlaySupported = isElementSupported(elementCode)
  const overlayConfig = getElementConfig(elementCode)

  function flyToSector(code: string) {
    if (!viewer) return
    const bounds = GRAPHICAL_SECTOR_BOUNDS[code]
    if (!bounds) return
    suppressNextMoveEndRef.current = true
    viewer.camera.flyTo({
      destination: Cesium.Rectangle.fromDegrees(...bounds),
    })
  }

  function handleSectorChange(value: string) {
    setSector(value)
    setImageLoaded(false)
    setImageError(false)
    flyToSector(value)
  }

  function removeOverlayLayer() {
    if (viewer && overlayLayerRef.current) {
      viewer.imageryLayers.remove(overlayLayerRef.current)
      overlayLayerRef.current = null
    }
  }

  function removeOverlayLabels() {
    if (viewer) {
      for (const entity of overlayLabelsRef.current) {
        viewer.entities.remove(entity)
      }
    }
    overlayLabelsRef.current = []
  }

  async function refreshOverlay(forElementCode: string) {
    if (!viewer || !isElementSupported(forElementCode)) return
    const requestId = ++overlayRequestIdRef.current
    const isStale = () => overlayRequestIdRef.current !== requestId

    setOverlayLoading(true)
    setOverlayError(null)
    try {
      const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid)
      if (!rectangle) throw new Error('no view rectangle')

      const candidates = await fetchLandmarks(viewer, rectangle)
      if (isStale()) return

      const landmarks = declutterByScreenSpace(viewer, [
        { items: candidates.filter((l) => l.kind === 'city'), maxCount: 12 },
        { items: candidates.filter((l) => l.kind === 'peak'), maxCount: 8 },
      ])
      if (landmarks.length < 3) {
        setOverlayError('Not enough named cities or peaks found in this view to build an overlay.')
        removeOverlayLayer()
        removeOverlayLabels()
        setOverlaySamples([])
        return
      }

      const found = await fetchElementSamples(landmarks, forElementCode)
      if (isStale()) return
      if (found.length === 0) {
        setOverlayError('No NWS data available here — coverage is the US and territories only.')
        removeOverlayLayer()
        removeOverlayLabels()
        setOverlaySamples([])
        return
      }

      const provider = await buildElementHeatmapProvider(rectangle, found, forElementCode)
      if (isStale() || !provider) return

      removeOverlayLayer()
      removeOverlayLabels()
      const layer = viewer.imageryLayers.addImageryProvider(provider)
      layer.alpha = overlayOpacityRef.current
      overlayLayerRef.current = layer

      const labels = buildOverlayLabelEntities(found, forElementCode)
      for (const entity of labels) viewer.entities.add(entity)
      overlayLabelsRef.current = labels

      setOverlaySamples(found)
    } catch (e) {
      if (isStale()) return
      setOverlayError(
        e instanceof Error && e.message.includes('too large')
          ? 'Zoom in closer to sample landmark data for this area.'
          : 'Could not load map overlay data.',
      )
    } finally {
      if (!isStale()) setOverlayLoading(false)
    }
  }

  function handleOverlayToggle(checked: boolean) {
    setOverlayEnabled(checked)
    if (checked) {
      refreshOverlay(elementCode)
    } else {
      removeOverlayLayer()
      removeOverlayLabels()
      setOverlaySamples([])
      setOverlayError(null)
    }
  }

  function handleOverlayOpacityChange(value: number) {
    overlayOpacityRef.current = value
    if (overlayLayerRef.current) {
      overlayLayerRef.current.alpha = value
    }
  }

  useEffect(() => {
    return () => {
      removeOverlayLayer()
      removeOverlayLabels()
    }
  }, [viewer])

  function handleElementChange(value: string) {
    setElementCode(value)
    setPeriod(1)
    setImageLoaded(false)
    setImageError(false)
    if (overlayEnabled) {
      if (isElementSupported(value)) {
        refreshOverlay(value)
      } else {
        removeOverlayLayer()
        removeOverlayLabels()
        setOverlaySamples([])
        setOverlayError(null)
      }
    }
  }

  function handlePeriodChange(value: number) {
    setPeriod(value)
    setImageLoaded(false)
    setImageError(false)
  }

  useEffect(() => {
    sectorRef.current = sector
  }, [sector])

  // Keep the region selection in sync as the map is panned — but not right
  // after we ourselves flew the camera to a region/state pick, since that
  // would immediately snap a broader region (e.g. "Pacific Northwest") back
  // down to whichever single state happens to be under its center. Also
  // only touch state when the sector actually changes — resetting the image
  // loading flags on every camera nudge left the (unchanged, same-src) img
  // permanently stuck showing "Loading…" since onLoad never refires for a
  // src that didn't change.
  useEffect(() => {
    if (!viewer) return
    function onMoveEnd() {
      if (suppressNextMoveEndRef.current) {
        suppressNextMoveEndRef.current = false
        return
      }
      const center = getMapCenter(viewer!)
      if (!center) return
      const found = findStateSectorForPoint(center.lat, center.lon)
      if (!found || found === sectorRef.current) return
      setSector(found)
      setImageLoaded(false)
      setImageError(false)
    }
    viewer.camera.moveEnd.addEventListener(onMoveEnd)
    return () => {
      viewer.camera.moveEnd.removeEventListener(onMoveEnd)
    }
  }, [viewer])

  // Draw the selected region's bounding box on the map. Approximate
  // rectangles, not true state borders.
  useEffect(() => {
    if (!viewer) return
    const bounds = GRAPHICAL_SECTOR_BOUNDS[sector]
    if (!bounds) return
    const entity = addTerrainBoundsBorder(viewer, bounds)
    return () => {
      viewer.entities.remove(entity)
    }
  }, [viewer, sector])

  const imageUrl = graphicalImageUrl(sector, element.code, period)
  const sectorLabel = ALL_SECTORS.find((s) => s.code === sector)?.label ?? sector

  return (
    <div>
      <div className="graphical-region-row">
        <label>
          Region
          <select value={sector} onChange={(e) => handleSectorChange(e.target.value)}>
            <optgroup label="Regions">
              {GRAPHICAL_REGIONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="States">
              {GRAPHICAL_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>

      <div className="graphical-image-frame">
        {!imageLoaded && !imageError && <p className="empty">Loading forecast image…</p>}
        {imageError && <p className="error">Could not load this forecast image.</p>}
        <img
          key={imageUrl}
          src={imageUrl}
          alt={`${element.label} forecast for ${sectorLabel}`}
          className="graphical-image"
          style={{ display: imageLoaded ? 'block' : 'none' }}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
        />
      </div>

      <h3>Element</h3>
      <div className="element-tabs">
        {GRAPHICAL_ELEMENTS.map((e) => (
          <button
            key={e.code}
            className={`element-tab ${elementCode === e.code ? 'active' : ''}`}
            onClick={() => handleElementChange(e.code)}
          >
            {e.label}
          </button>
        ))}
      </div>

      <div className="graphical-time-slider">
        <input
          type="range"
          min={1}
          max={element.maxPeriod}
          value={period}
          onChange={(e) => handlePeriodChange(Number(e.target.value))}
        />
        <span className="graphical-time-label">{periodDateLabel(element, period)}</span>
      </div>

      <h3>Map Overlay</h3>
      {overlaySupported ? (
        <>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={overlayEnabled}
              disabled={!viewer || overlayLoading}
              onChange={(e) => handleOverlayToggle(e.target.checked)}
            />
            Show {element.label} on the map
          </label>

          {overlayLoading && <p className="empty">Sampling {element.label.toLowerCase()}…</p>}
          {overlayError && <p className="error">{overlayError}</p>}

          {overlayEnabled && overlaySamples.length > 0 && overlayConfig && (
            <div className="weather-controls">
              <button onClick={() => refreshOverlay(elementCode)} disabled={overlayLoading}>
                Refresh for this view
              </button>

              <div className="slider-row">
                <label htmlFor="overlay-opacity">Opacity</label>
                <input
                  id="overlay-opacity"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  defaultValue={overlayOpacityRef.current}
                  onChange={(e) => handleOverlayOpacityChange(Number(e.target.value))}
                />
              </div>

              <div className="legend-scale">
                {overlayConfig.legendMarks.map((mark) => (
                  <div
                    key={mark}
                    className="legend-swatch"
                    style={{ background: rgbStringForValue(elementCode, mark) }}
                  >
                    {overlayConfig.formatValue(mark)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="empty">Map overlay isn't available for {element.label.toLowerCase()}.</p>
      )}

      <p className="empty">
        NOAA's own live Graphical Forecast image (graphical.weather.gov) above. The map overlay
        below is our own approximate rendering (sampled cities/peaks + interpolation), not NOAA's
        actual data/colors. The region follows the map as you pan it, and picking a region here
        flies the map there.
      </p>
    </div>
  )
}
