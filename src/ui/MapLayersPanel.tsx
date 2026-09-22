import { useEffect, useRef, useState } from 'react'
import { IconLayers } from './icons'
import { MapPanel } from './panels/MapPanel'

const MIN_WIDTH = 260
const MAX_WIDTH = 640
const DEFAULT_WIDTH = 320
const WIDTH_STORAGE_KEY = 'mapapp.mapLayersWidth'
const OPEN_STORAGE_KEY = 'mapapp.mapLayersOpen'

function loadStoredWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY)
    const parsed = raw ? Number(raw) : NaN
    return Number.isFinite(parsed) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed)) : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

function loadStoredOpen(): boolean {
  try {
    const raw = localStorage.getItem(OPEN_STORAGE_KEY)
    return raw === null ? true : raw === 'true'
  } catch {
    return true
  }
}

/**
 * Map Layers (base layer + overlay picker), docked to the right edge —
 * CalTopo-style, separate from the left tabbed sidebar (Places/Weather/
 * Routes) so it's always reachable alongside whichever of those is open.
 * Mirrors Sidebar's own toggle+resizable-drawer pattern, just flipped to
 * the right side.
 */
export function MapLayersPanel() {
  const [open, setOpen] = useState(loadStoredOpen)
  const [width, setWidth] = useState(loadStoredWidth)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    function handlePointerMove(e: PointerEvent) {
      const drag = dragRef.current
      if (!drag) return
      // Anchored to the right edge, so dragging left (negative dx) grows it.
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, drag.startWidth - (e.clientX - drag.startX))))
    }
    function handlePointerUp() {
      if (!dragRef.current) return
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setWidth((w) => {
        try {
          localStorage.setItem(WIDTH_STORAGE_KEY, String(w))
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

  function toggleOpen() {
    setOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem(OPEN_STORAGE_KEY, String(next))
      } catch {
        // localStorage unavailable — open/closed state just won't persist
      }
      return next
    })
  }

  return (
    <div className="right-panel">
      <div className="map-layers-tab">
        <button
          className={`map-layers-toggle ${open ? 'active' : ''}`}
          onClick={toggleOpen}
          title={open ? 'Collapse Map Layers' : 'Show Map Layers'}
        >
          <IconLayers />
          <span>Layers</span>
        </button>
      </div>
      {open && (
        <div className="drawer map-layers-drawer" style={{ width }}>
          <div className="resize-handle right-resize-handle" onPointerDown={startResize} />
          <MapPanel />
        </div>
      )}
    </div>
  )
}
