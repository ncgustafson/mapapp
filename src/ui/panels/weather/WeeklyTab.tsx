import { useEffect, useRef, useState, type FormEvent } from 'react'
import * as Cesium from 'cesium'
import { useCesiumViewer } from '../../../cesium/CesiumContext'
import { getMapCenter } from '../../../cesium/mapCenter'
import { fetchWeeklyForecast, type WeeklyForecastResult } from '../../../weather/weeklyForecast'
import { staticLocatorMapUrl } from '../../../weather/staticMap'

function destinationToLatLon(destination: Cesium.Cartesian3 | Cesium.Rectangle): { lat: number; lon: number } {
  if (destination instanceof Cesium.Rectangle) {
    const center = Cesium.Rectangle.center(destination)
    return { lat: Cesium.Math.toDegrees(center.latitude), lon: Cesium.Math.toDegrees(center.longitude) }
  }
  const carto = Cesium.Cartographic.fromCartesian(destination)
  return { lat: Cesium.Math.toDegrees(carto.latitude), lon: Cesium.Math.toDegrees(carto.longitude) }
}

// Half-width of the forecast-area square, in degrees — roughly matches how
// prominent NOAA's own green square looks on their locator thumbnail.
const FORECAST_SQUARE_HALF_DEG = 0.015

export function WeeklyTab() {
  const viewer = useCesiumViewer()
  const markerRef = useRef<Cesium.Entity | null>(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null)
  const [result, setResult] = useState<WeeklyForecastResult | null>(null)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  useEffect(() => {
    return () => {
      if (viewer && markerRef.current) {
        viewer.entities.remove(markerRef.current)
      }
    }
  }, [viewer])

  function showForecastAreaMarker(lat: number, lon: number) {
    if (!viewer) return
    if (markerRef.current) {
      viewer.entities.remove(markerRef.current)
    }
    const d = FORECAST_SQUARE_HALF_DEG
    markerRef.current = viewer.entities.add({
      rectangle: {
        coordinates: Cesium.Rectangle.fromDegrees(lon - d, lat - d, lon + d, lat + d),
        material: Cesium.Color.fromCssColorString('#22c55e').withAlpha(0.45),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#22c55e'),
        outlineWidth: 2,
        classificationType: Cesium.ClassificationType.TERRAIN,
      },
    })
  }

  async function loadForecast(lat: number, lon: number, flyTo: boolean) {
    setLoading(true)
    setError(null)
    try {
      const found = await fetchWeeklyForecast(lat, lon)
      setResult(found)
      setLocation({ lat, lon })
      setExpandedIndex(null)
      showForecastAreaMarker(lat, lon)
      if (flyTo && viewer) {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, 40000),
        })
      }
    } catch {
      setError('Could not load a forecast here — coverage is the US and territories only.')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault()
    if (!viewer || !query.trim()) return
    setSearching(true)
    setError(null)
    try {
      const geocoder = new Cesium.IonGeocoderService({ scene: viewer.scene })
      const found = await geocoder.geocode(query)
      if (found.length === 0) {
        setError('No results found.')
        return
      }
      const { lat, lon } = destinationToLatLon(found[0].destination)
      await loadForecast(lat, lon, true)
    } catch {
      setError('Search failed.')
    } finally {
      setSearching(false)
    }
  }

  async function useMapCenter() {
    if (!viewer) return
    const center = getMapCenter(viewer)
    if (!center) return
    await loadForecast(center.lat, center.lon, false)
  }

  return (
    <div className="weather-controls">
      <form onSubmit={handleSearch} className="search-form">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a place…"
        />
        <button type="submit" disabled={!viewer || searching}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>
      <button onClick={useMapCenter} disabled={!viewer || loading}>
        Use map center instead
      </button>

      {loading && <p className="empty">Loading forecast…</p>}
      {error && <p className="error">{error}</p>}

      {result && location && (
        <>
          <h3>
            Extended Forecast
            {result.city ? ` for ${result.city}${result.state ? `, ${result.state}` : ''}` : ''}
          </h3>

          <div className="locator-map">
            <img src={staticLocatorMapUrl(location.lat, location.lon)} alt="Forecast location" />
            <div className="locator-pin" />
          </div>

          <div className="forecast-cards">
            {result.periods.map((p, i) => (
              <button
                key={i}
                className={`forecast-card ${expandedIndex === i ? 'active' : ''}`}
                onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
              >
                <div className="forecast-card-name">{p.name}</div>
                <img src={p.iconUrl} alt={p.shortForecast} className="forecast-card-icon" />
                {p.precipChance !== null && p.precipChance > 0 && (
                  <div className="forecast-card-precip">{p.precipChance}%</div>
                )}
                <div className={`forecast-card-temp ${p.isDaytime ? 'high' : 'low'}`}>
                  {p.isDaytime ? 'High' : 'Low'}: {p.tempF}°
                </div>
                <div className="forecast-card-short">{p.shortForecast}</div>
              </button>
            ))}
          </div>

          <h3>Detailed Forecast</h3>
          <ul className="detailed-forecast-list">
            {result.periods.map((p, i) => (
              <li key={i} className={expandedIndex === i ? 'highlighted' : ''}>
                <span className="detailed-forecast-name">{p.name}</span>
                <span className="detailed-forecast-text">{p.detailedForecast}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {!result && !loading && (
        <p className="empty">
          Search for a place above, or use the current map center, to see NOAA's 7-day forecast.
        </p>
      )}
    </div>
  )
}
