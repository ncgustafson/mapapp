import { useEffect, useRef, useState } from 'react'
import { PlacesPanel } from './panels/PlacesPanel'
import { WeatherPanel } from './panels/WeatherPanel'
import { RoutePanel } from './panels/RoutePanel'

type PanelKey = 'places' | 'weather' | 'routes'

const PANELS: { key: PanelKey; label: string }[] = [
  { key: 'places', label: 'Places' },
  { key: 'weather', label: 'Weather' },
  { key: 'routes', label: 'Routes' },
]

const MIN_WIDTH = 260
const MAX_WIDTH = 640
const DEFAULT_WIDTH = 320
const STORAGE_KEY = 'mapapp.drawerWidth'

function loadStoredWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? Number(raw) : NaN
    return Number.isFinite(parsed) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed)) : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

export function Sidebar() {
  const [active, setActive] = useState<PanelKey | null>('places')
  const [width, setWidth] = useState(loadStoredWidth)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    function handlePointerMove(e: PointerEvent) {
      const drag = dragRef.current
      if (!drag) return
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, drag.startWidth + (e.clientX - drag.startX))))
    }
    function handlePointerUp() {
      if (!dragRef.current) return
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setWidth((w) => {
        try {
          localStorage.setItem(STORAGE_KEY, String(w))
        } catch {
          // localStorage unavailable — resized width just won't persist
        }
        return w
      })
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

  function startResize(e: React.PointerEvent) {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: width }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

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
        <div className="drawer" style={{ width }}>
          {active === 'places' && <PlacesPanel />}
          {active === 'weather' && <WeatherPanel />}
          {active === 'routes' && <RoutePanel />}
          <div className="resize-handle" onPointerDown={startResize} />
        </div>
      )}
    </div>
  )
}
