import { useState } from 'react'
import { PlacesPanel } from './panels/PlacesPanel'
import { WeatherPanel } from './panels/WeatherPanel'
import { RoutePanel } from './panels/RoutePanel'

type PanelKey = 'places' | 'weather' | 'routes'

const PANELS: { key: PanelKey; label: string }[] = [
  { key: 'places', label: 'Places' },
  { key: 'weather', label: 'Weather' },
  { key: 'routes', label: 'Routes' },
]

export function Sidebar() {
  const [active, setActive] = useState<PanelKey | null>('places')

  return (
    <div className="sidebar">
      <div className="icon-rail">
        {PANELS.map((p) => (
          <button
            key={p.key}
            className={`icon-button ${active === p.key ? 'active' : ''}`}
            onClick={() => setActive(active === p.key ? null : p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {active && (
        <div className="drawer">
          {active === 'places' && <PlacesPanel />}
          {active === 'weather' && <WeatherPanel />}
          {active === 'routes' && <RoutePanel />}
        </div>
      )}
    </div>
  )
}
