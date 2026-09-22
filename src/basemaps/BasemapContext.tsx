import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import * as Cesium from 'cesium'
import { useCesiumViewer } from '../cesium/CesiumContext'
import { BASEMAPS, DEFAULT_BASEMAP_ID, OVERLAYS } from './basemaps'

type BasemapContextValue = {
  activeBasemapId: string
  setBasemap: (id: string) => void
  activeOverlayIds: string[]
  toggleOverlay: (id: string) => void
}

const BasemapContext = createContext<BasemapContextValue | null>(null)

export function useBasemaps(): BasemapContextValue {
  const ctx = useContext(BasemapContext)
  if (!ctx) throw new Error('useBasemaps must be used within a BasemapProvider')
  return ctx
}

const BASEMAP_STORAGE_KEY = 'mapapp.basemap'
const OVERLAY_STORAGE_KEY = 'mapapp.overlays'

function loadStoredBasemap(): string {
  try {
    const raw = localStorage.getItem(BASEMAP_STORAGE_KEY)
    const match = BASEMAPS.find((b) => b.id === raw && !b.disabled)
    return match ? match.id : DEFAULT_BASEMAP_ID
  } catch {
    return DEFAULT_BASEMAP_ID
  }
}

function loadStoredOverlays(): string[] {
  try {
    const raw = localStorage.getItem(OVERLAY_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id) => OVERLAYS.some((o) => o.id === id)) : []
  } catch {
    return []
  }
}

/**
 * Owns the base imagery layer + optional overlay layers (Forest Service
 * roads, etc.) on the shared Cesium viewer. Mounted once, high up the tree
 * (not inside the Map sidebar panel) so the chosen basemap keeps rendering
 * even while that panel isn't open.
 */
export function BasemapProvider({ children }: { children: ReactNode }) {
  const viewer = useCesiumViewer()
  const [activeBasemapId, setActiveBasemapId] = useState(loadStoredBasemap)
  const [activeOverlayIds, setActiveOverlayIds] = useState<string[]>(loadStoredOverlays)

  const baseLayerRef = useRef<Cesium.ImageryLayer | null>(null)
  const overlayLayersRef = useRef<Map<string, Cesium.ImageryLayer>>(new Map())
  const basemapRequestIdRef = useRef(0)

  // Base layer: always kept at imagery-layer index 0. Adds the new one
  // before removing the old one so there's never a frame with no basemap.
  useEffect(() => {
    if (!viewer) return
    const def = BASEMAPS.find((b) => b.id === activeBasemapId) ?? BASEMAPS[0]
    const requestId = ++basemapRequestIdRef.current

    def.createProvider().then((provider) => {
      if (basemapRequestIdRef.current !== requestId) return // superseded by a later switch
      const previous = baseLayerRef.current
      baseLayerRef.current = viewer.imageryLayers.addImageryProvider(provider, 0)
      if (previous) viewer.imageryLayers.remove(previous, true)
    })
  }, [viewer, activeBasemapId])

  // Overlays: add/remove individual layers as the active set changes.
  useEffect(() => {
    if (!viewer) return
    const current = overlayLayersRef.current

    for (const [id, layer] of current) {
      if (!activeOverlayIds.includes(id)) {
        viewer.imageryLayers.remove(layer, true)
        current.delete(id)
      }
    }

    for (const id of activeOverlayIds) {
      if (current.has(id)) continue
      const def = OVERLAYS.find((o) => o.id === id)
      if (!def) continue
      def.createProvider().then((provider) => {
        if (!activeOverlayIds.includes(id) || current.has(id)) return // toggled off, or re-added, while loading
        current.set(id, viewer.imageryLayers.addImageryProvider(provider))
      })
    }
  }, [viewer, activeOverlayIds])

  useEffect(() => {
    return () => {
      if (!viewer) return
      if (baseLayerRef.current) viewer.imageryLayers.remove(baseLayerRef.current, true)
      for (const layer of overlayLayersRef.current.values()) {
        viewer.imageryLayers.remove(layer, true)
      }
      overlayLayersRef.current.clear()
      baseLayerRef.current = null
    }
  }, [viewer])

  function setBasemap(id: string) {
    setActiveBasemapId(id)
    try {
      localStorage.setItem(BASEMAP_STORAGE_KEY, id)
    } catch {
      // localStorage unavailable — selection just won't persist
    }
  }

  function toggleOverlay(id: string) {
    setActiveOverlayIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      try {
        localStorage.setItem(OVERLAY_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // localStorage unavailable — selection just won't persist
      }
      return next
    })
  }

  return (
    <BasemapContext.Provider value={{ activeBasemapId, setBasemap, activeOverlayIds, toggleOverlay }}>
      {children}
    </BasemapContext.Provider>
  )
}
