import { createContext, useContext, useState, type ReactNode } from 'react'
import * as Cesium from 'cesium'
import { useCesiumViewer } from '../cesium/CesiumContext'
import { planRouteWithAgent } from './routeAgent'
import { traceAlongTrails } from './trailNetwork'
import {
  loadRoutes,
  pathDistanceMeters,
  pathElevationGainLoss,
  pathElevationProfile,
  persistRoutes,
  type ElevationProfilePoint,
  type LatLon,
  type RouteFeature,
  type RouteKind,
} from './routeTypes'

type RouteContextValue = {
  routes: RouteFeature[]
  drawMode: RouteKind | null
  draftPoints: LatLon[]
  selectedRouteId: string | null
  startDrawing: (kind: RouteKind) => void
  addDraftPoint: (point: LatLon) => void
  finishDrawing: () => void
  cancelDrawing: () => void
  deleteRoute: (id: string) => void
  flyToRoute: (id: string) => void
  selectRoute: (id: string | null) => void
  toggleVisibility: (id: string) => void
  getElevationProfile: (id: string) => Promise<ElevationProfilePoint[]>
  agentBusy: boolean
  agentStatus: string | null
  agentError: string | null
  createRouteFromPrompt: (prompt: string) => void
}

const RouteContext = createContext<RouteContextValue | null>(null)

export function useRoutes(): RouteContextValue {
  const ctx = useContext(RouteContext)
  if (!ctx) throw new Error('useRoutes must be used within a RouteProvider')
  return ctx
}

function minPointsFor(kind: RouteKind): number {
  return kind === 'point' ? 1 : kind === 'line' ? 2 : 3
}

// Framing by lon/lat rectangle alone (or a fixed height "above the
// ellipsoid") ignores actual terrain elevation — on a mountain, the
// ellipsoid surface can be thousands of meters below the real ground, so
// the computed camera position ends up *inside* the terrain. Sampling real
// terrain height and building a proper 3D bounding sphere avoids that.
async function flyToPoints(viewer: Cesium.Viewer, points: LatLon[]) {
  const cartographics = points.map((p) => Cesium.Cartographic.fromDegrees(p.lon, p.lat))
  let sampled = cartographics
  try {
    sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographics)
  } catch {
    // Best-effort — fall back to flying to the un-sampled (sea-level) points.
  }

  const positions = sampled.map((c) => Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height ?? 0))
  const boundingSphere = Cesium.BoundingSphere.fromPoints(positions)
  // A single point (or a very short route) collapses to a ~0 radius sphere,
  // which would put the camera right on top of the ground — keep a sane
  // minimum viewing distance.
  boundingSphere.radius = Math.max(boundingSphere.radius, 400)

  viewer.camera.flyToBoundingSphere(boundingSphere, {
    offset: new Cesium.HeadingPitchRange(viewer.camera.heading, Cesium.Math.toRadians(-30), boundingSphere.radius * 3),
  })
}

/**
 * Owns saved routes/points/polygons (localStorage-backed, like Saved
 * Places) plus in-progress drawing state. Mounted inside MapView so it can
 * fly the camera; DrawingLayer (also inside MapView) renders everything on
 * the globe and feeds clicks back in via addDraftPoint.
 */
export function RouteProvider({ children }: { children: ReactNode }) {
  const viewer = useCesiumViewer()
  const [routes, setRoutes] = useState<RouteFeature[]>(loadRoutes)
  const [drawMode, setDrawMode] = useState<RouteKind | null>(null)
  const [draftPoints, setDraftPoints] = useState<LatLon[]>([])
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentStatus, setAgentStatus] = useState<string | null>(null)
  const [agentError, setAgentError] = useState<string | null>(null)

  function startDrawing(kind: RouteKind) {
    setDrawMode(kind)
    setDraftPoints([])
    setSelectedRouteId(null)
  }

  function cancelDrawing() {
    setDrawMode(null)
    setDraftPoints([])
  }

  function addDraftPoint(point: LatLon) {
    if (!drawMode) return
    if (drawMode === 'point') {
      void saveDraft('point', [point])
      setDrawMode(null)
      setDraftPoints([])
      return
    }
    setDraftPoints((prev) => [...prev, point])
  }

  function finishDrawing() {
    if (!drawMode || draftPoints.length < minPointsFor(drawMode)) return
    void saveDraft(drawMode, draftPoints)
    setDrawMode(null)
    setDraftPoints([])
  }

  async function persistFeature(kind: RouteKind, name: string, rawPoints: LatLon[]) {
    let points = rawPoints
    const closed = kind === 'polygon'
    if (kind !== 'point') {
      // CalTopo-style snap-to-trail: wherever consecutive points are close
      // enough to a real trail/road to snap onto it, replace the straight
      // segment between them with the actual on-the-ground path. Applies
      // equally to manually-drawn clicks and AI-proposed points — best
      // effort, falls back to the original points on any failure.
      try {
        points = await traceAlongTrails(rawPoints, closed)
      } catch {
        // Keep the raw points.
      }
    }

    const feature: RouteFeature = { id: crypto.randomUUID(), kind, name, points, visible: true }
    if (kind !== 'point') {
      feature.distanceMeters = pathDistanceMeters(points, closed)
      if (viewer) {
        try {
          const { gain, loss } = await pathElevationGainLoss(viewer, points, closed)
          feature.elevationGainMeters = gain
          feature.elevationLossMeters = loss
        } catch {
          // Best-effort — save without elevation stats if terrain sampling fails.
        }
      }
    }

    setRoutes((prev) => {
      const next = [...prev, feature]
      persistRoutes(next)
      return next
    })
    return feature
  }

  async function saveDraft(kind: RouteKind, points: LatLon[]) {
    const name = window.prompt(`Name this ${kind}:`)
    if (!name) return
    await persistFeature(kind, name, points)
  }

  function deleteRoute(id: string) {
    setRoutes((prev) => {
      const next = prev.filter((r) => r.id !== id)
      persistRoutes(next)
      return next
    })
    setSelectedRouteId((prev) => (prev === id ? null : prev))
  }

  function flyToRoute(id: string) {
    if (!viewer) return
    const route = routes.find((r) => r.id === id)
    if (route) void flyToPoints(viewer, route.points)
  }

  function selectRoute(id: string | null) {
    setSelectedRouteId(id)
  }

  async function getElevationProfile(id: string): Promise<ElevationProfilePoint[]> {
    if (!viewer) return []
    const route = routes.find((r) => r.id === id)
    if (!route || route.kind === 'point') return []
    return pathElevationProfile(viewer, route.points, route.kind === 'polygon')
  }

  function createRouteFromPrompt(prompt: string) {
    if (!viewer || agentBusy) return
    setAgentBusy(true)
    setAgentError(null)
    setAgentStatus('Thinking…')
    planRouteWithAgent(viewer, prompt, setAgentStatus)
      .then(async (proposal) => {
        const feature = await persistFeature(proposal.kind, proposal.name, proposal.points)
        void flyToPoints(viewer, feature.points)
      })
      .catch((err: unknown) => {
        setAgentError(err instanceof Error ? err.message : 'Something went wrong asking the agent.')
      })
      .finally(() => {
        setAgentBusy(false)
        setAgentStatus(null)
      })
  }

  function toggleVisibility(id: string) {
    let nowHidden = false
    setRoutes((prev) => {
      const next = prev.map((r) => {
        if (r.id !== id) return r
        const visible = !(r.visible ?? true)
        nowHidden = !visible
        return { ...r, visible }
      })
      persistRoutes(next)
      return next
    })
    if (nowHidden) setSelectedRouteId((prev) => (prev === id ? null : prev))
  }

  return (
    <RouteContext.Provider
      value={{
        routes,
        drawMode,
        draftPoints,
        selectedRouteId,
        startDrawing,
        addDraftPoint,
        finishDrawing,
        cancelDrawing,
        deleteRoute,
        flyToRoute,
        selectRoute,
        toggleVisibility,
        getElevationProfile,
        agentBusy,
        agentStatus,
        agentError,
        createRouteFromPrompt,
      }}
    >
      {children}
    </RouteContext.Provider>
  )
}
