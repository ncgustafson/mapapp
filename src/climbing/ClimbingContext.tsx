import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import * as Cesium from 'cesium'
import { useCesiumViewer } from '../cesium/CesiumContext'
import { fetchClimbingRoutes, PINE_CREEK_CANYON_UUID, type ClimbingRoute } from './openbeta'

type ClimbingContextValue = {
  routes: ClimbingRoute[]
  loading: boolean
  error: string | null
  selectedClimbId: string | null
  selectClimb: (id: string | null) => void
  flyToClimb: (id: string) => void
}

const ClimbingContext = createContext<ClimbingContextValue | null>(null)

export function useClimbing(): ClimbingContextValue {
  const ctx = useContext(ClimbingContext)
  if (!ctx) throw new Error('useClimbing must be used within a ClimbingProvider')
  return ctx
}

/**
 * Owns the Pine Creek Canyon climbing route list (fetched once from
 * OpenBeta on mount) plus selection state. Mirrors RouteContext's shape so
 * ClimbingLayer/ClimbingPanel/ClimbingPopup can follow the same pattern as
 * the hiking-route equivalents.
 */
export function ClimbingProvider({ children }: { children: ReactNode }) {
  const viewer = useCesiumViewer()
  const [routes, setRoutes] = useState<ClimbingRoute[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedClimbId, setSelectedClimbId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchClimbingRoutes(PINE_CREEK_CANYON_UUID)
      .then((result) => {
        if (!cancelled) setRoutes(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load climbing routes.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function selectClimb(id: string | null) {
    setSelectedClimbId(id)
  }

  async function flyToClimb(id: string) {
    if (!viewer) return
    const route = routes.find((r) => r.id === id)
    if (!route) return
    // Every route on a wall shares one coordinate (see openbeta.ts) — this
    // flies to the wall, not a precise per-route spot.
    //
    // Red Rock sits well above sea level — fromDegrees(lon, lat, 0) places
    // the target at ellipsoid height 0, which is *underground* here. Sample
    // real terrain height first (same fix RouteContext.flyToPoints uses),
    // or the camera ends up flying into the mountain.
    let height = 0
    try {
      const [sampled] = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [
        Cesium.Cartographic.fromDegrees(route.lon, route.lat),
      ])
      height = sampled.height ?? 0
    } catch {
      // Best-effort — falls back to flying toward sea level if sampling fails.
    }
    const position = Cesium.Cartesian3.fromDegrees(route.lon, route.lat, height)
    // A near-horizontal pitch only shows the cliff if the camera's
    // (inherited, arbitrary) heading happens to face it — there's no wall
    // orientation/bearing in the data to aim toward. A steeper, more
    // top-down pitch reliably shows the surrounding relief regardless of
    // heading, at the cost of a less dramatic "standing at the base" shot.
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(position, 500), {
      offset: new Cesium.HeadingPitchRange(viewer.camera.heading, Cesium.Math.toRadians(-45), 1500),
    })
  }

  return (
    <ClimbingContext.Provider value={{ routes, loading, error, selectedClimbId, selectClimb, flyToClimb }}>
      {children}
    </ClimbingContext.Provider>
  )
}
