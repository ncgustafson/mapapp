import { BASEMAPS, OVERLAYS } from '../../basemaps/basemaps'
import { useBasemaps } from '../../basemaps/BasemapContext'

export function MapPanel() {
  const { activeBasemapId, setBasemap, activeOverlayIds, toggleOverlay } = useBasemaps()

  return (
    <div className="map-layers">
      <div className="map-layers-title">Map Layers</div>

      <div className="map-layers-section-label">Base Layers</div>
      <ul className="layer-list">
        {BASEMAPS.map((b) => (
          <li key={b.id}>
            <button
              className={`layer-row ${activeBasemapId === b.id ? 'active' : ''}`}
              onClick={() => setBasemap(b.id)}
              disabled={b.disabled}
              title={b.description}
            >
              <span className="layer-swatch" style={{ background: b.swatch }} />
              <span className="layer-row-label">{b.label}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="map-layers-section-label">Overlays</div>
      <ul className="layer-list">
        {OVERLAYS.map((o) => (
          <li key={o.id}>
            <label className="layer-row layer-row-checkbox" title={o.description}>
              <input type="checkbox" checked={activeOverlayIds.includes(o.id)} onChange={() => toggleOverlay(o.id)} />
              <span className="layer-swatch" style={{ background: o.swatch }} />
              <span className="layer-row-label">{o.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
