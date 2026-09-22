import { useEffect, useState, type ComponentType } from 'react'
import * as Cesium from 'cesium'
import { useCesiumViewer } from '../cesium/CesiumContext'
import { IconLine, IconPoint, IconPolygon } from '../ui/icons'
import { useRoutes } from './RouteContext'
import { formatDistance, formatElevation, KIND_COLORS, type RouteKind } from './routeTypes'

const KIND_ICON: Record<RouteKind, ComponentType<{ className?: string }>> = {
  line: IconLine,
  point: IconPoint,
  polygon: IconPolygon,
}

/**
 * Floating info card that follows a selected route's anchor point on
 * screen (Cesium's own info box is disabled app-wide, so this replaces it
 * for map-clicked routes/points/polygons — see DrawingLayer's click
 * handler for the picking side).
 */
export function RoutePopup() {
  const viewer = useCesiumViewer()
  const { routes, selectedRouteId, selectRoute, deleteRoute, flyToRoute } = useRoutes()
  const [screenPos, setScreenPos] = useState<{ x: number; y: number } | null>(null)

  const route = routes.find((r) => r.id === selectedRouteId) ?? null

  useEffect(() => {
    if (!viewer || !route) {
      setScreenPos(null)
      return
    }
    const anchor = Cesium.Cartesian3.fromDegrees(route.points[0].lon, route.points[0].lat)

    function update() {
      const canvasPos = Cesium.SceneTransforms.worldToWindowCoordinates(viewer!.scene, anchor)
      setScreenPos(canvasPos ? { x: canvasPos.x, y: canvasPos.y } : null)
    }

    update()
    viewer.scene.postRender.addEventListener(update)
    return () => {
      viewer.scene.postRender.removeEventListener(update)
    }
    // route.points[0] is enough to key off — a route's own points don't
    // change after it's saved.
  }, [viewer, route?.id])

  if (!route || !screenPos) return null

  const Icon = KIND_ICON[route.kind]

  return (
    <div className="route-popup" style={{ left: screenPos.x, top: screenPos.y }}>
      <button className="route-popup-close" onClick={() => selectRoute(null)} aria-label="Close">
        ×
      </button>
      <div className="route-popup-name">
        <span className="route-popup-swatch" style={{ color: KIND_COLORS[route.kind] }}>
          <Icon />
        </span>
        {route.name}
      </div>
      {route.distanceMeters !== undefined && (
        <div className="route-popup-stats">
          {formatDistance(route.distanceMeters)}
          {route.elevationGainMeters !== undefined && (
            <>
              {' '}
              · ↑{formatElevation(route.elevationGainMeters)} ↓{formatElevation(route.elevationLossMeters ?? 0)}
            </>
          )}
        </div>
      )}
      <div className="route-popup-actions">
        <button onClick={() => flyToRoute(route.id)}>Fly to</button>
        <button
          onClick={() => {
            deleteRoute(route.id)
            selectRoute(null)
          }}
        >
          Delete
        </button>
      </div>
    </div>
  )
}
