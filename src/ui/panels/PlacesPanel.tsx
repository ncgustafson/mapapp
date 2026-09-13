import { useMemo, useState, type FormEvent } from 'react'
import * as Cesium from 'cesium'
import { useCesiumViewer } from '../../cesium/CesiumContext'

type SavedPlace = {
  id: string
  name: string
  heading: number
  pitch: number
  destination: [number, number, number]
}

const STORAGE_KEY = 'mapapp.savedPlaces'

function loadSavedPlaces(): SavedPlace[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persistSavedPlaces(places: SavedPlace[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(places))
  } catch {
    // localStorage unavailable (e.g. private browsing) — saves just won't persist
  }
}

export function PlacesPanel() {
  const viewer = useCesiumViewer()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Cesium.GeocoderService.Result[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>(() => loadSavedPlaces())

  const geocoder = useMemo(() => {
    if (!viewer) return null
    return new Cesium.IonGeocoderService({ scene: viewer.scene })
  }, [viewer])

  async function handleSearch(e: FormEvent) {
    e.preventDefault()
    if (!geocoder || !query.trim()) return
    setSearching(true)
    setError(null)
    try {
      const found = await geocoder.geocode(query)
      setResults(found)
      if (found.length === 0) setError('No results found.')
    } catch {
      setError('Search failed.')
    } finally {
      setSearching(false)
    }
  }

  function flyToResult(result: Cesium.GeocoderService.Result) {
    viewer?.camera.flyTo({ destination: result.destination })
    setResults([])
    setQuery('')
  }

  function flyToSaved(place: SavedPlace) {
    if (!viewer) return
    viewer.camera.flyTo({
      destination: new Cesium.Cartesian3(...place.destination),
      orientation: { heading: place.heading, pitch: place.pitch },
    })
  }

  function saveCurrentView() {
    if (!viewer) return
    const name = window.prompt('Name this place:')
    if (!name) return
    const pos = viewer.camera.positionWC
    const newPlace: SavedPlace = {
      id: crypto.randomUUID(),
      name,
      heading: viewer.camera.heading,
      pitch: viewer.camera.pitch,
      destination: [pos.x, pos.y, pos.z],
    }
    const updated = [...savedPlaces, newPlace]
    setSavedPlaces(updated)
    persistSavedPlaces(updated)
  }

  function deleteSaved(id: string) {
    const updated = savedPlaces.filter((p) => p.id !== id)
    setSavedPlaces(updated)
    persistSavedPlaces(updated)
  }

  return (
    <div className="panel">
      <h2>Places</h2>
      <form onSubmit={handleSearch} className="search-form">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a place..."
        />
        <button type="submit" disabled={searching || !viewer}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {results.length > 0 && (
        <ul className="result-list">
          {results.map((r, i) => (
            <li key={i}>
              <button onClick={() => flyToResult(r)}>{r.displayName}</button>
            </li>
          ))}
        </ul>
      )}

      <div className="saved-header">
        <h3>Saved places</h3>
        <button onClick={saveCurrentView} disabled={!viewer}>
          + Save view
        </button>
      </div>
      {savedPlaces.length === 0 ? (
        <p className="empty">No saved places yet.</p>
      ) : (
        <ul className="result-list">
          {savedPlaces.map((p) => (
            <li key={p.id}>
              <button onClick={() => flyToSaved(p)}>{p.name}</button>
              <button className="delete" onClick={() => deleteSaved(p.id)} aria-label={`Delete ${p.name}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
