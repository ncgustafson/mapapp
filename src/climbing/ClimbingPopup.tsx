import { useEffect, useState } from 'react'
import * as Cesium from 'cesium'
import { useCesiumViewer } from '../cesium/CesiumContext'
import { useClimbing } from './ClimbingContext'
import { BIRDLAND_TOPO } from './climbingTopo'
import { ClimbingTopoView } from './ClimbingTopoView'

/**
 * Floating info card for a clicked climbing marker — same pattern as
 * RoutePopup, just for climbs. Only Birdland has a topo right now (see
 * climbingTopo.ts); every other route shows its OpenBeta info with no
 * "View topo" button.
 */
export function ClimbingPopup() {
  const viewer = useCesiumViewer()
  const { routes, selectedClimbId, selectClimb } = useClimbing()
  const [screenPos, setScreenPos] = useState<{ x: number; y: number } | null>(null)
  const [topoOpen, setTopoOpen] = useState(false)

  const route = routes.find((r) => r.id === selectedClimbId) ?? null

  useEffect(() => {
    setTopoOpen(false)
  }, [selectedClimbId])

  useEffect(() => {
    if (!viewer || !route) {
      setScreenPos(null)
      return
    }
    const anchor = Cesium.Cartesian3.fromDegrees(route.lon, route.lat)

    function update() {
      const canvasPos = Cesium.SceneTransforms.worldToWindowCoordinates(viewer!.scene, anchor)
      setScreenPos(canvasPos ? { x: canvasPos.x, y: canvasPos.y } : null)
    }

    update()
    viewer.scene.postRender.addEventListener(update)
    return () => {
      viewer.scene.postRender.removeEventListener(update)
    }
  }, [viewer, route?.id])

  if (!route || !screenPos) return null

  const types = [route.trad && 'trad', route.sport && 'sport', route.topRope && 'top-rope'].filter(Boolean).join(' / ')
  const hasTopo = route.id === BIRDLAND_TOPO.climbId

  return (
    <>
      <div className="route-popup climbing-popup" style={{ left: screenPos.x, top: screenPos.y }}>
        <button className="route-popup-close" onClick={() => selectClimb(null)} aria-label="Close">
          ×
        </button>
        <div className="route-popup-name">{route.name}</div>
        <div className="route-popup-stats">
          {route.grade ?? 'Grade unknown'}
          {types && ` · ${types}`}
          {route.lengthFeet && ` · ${route.lengthFeet} ft`}
        </div>
        <div className="climbing-popup-wall">{route.wallName}</div>
        {route.fa && <div className="climbing-popup-fa">FA: {route.fa}</div>}
        <div className="route-popup-actions">
          {hasTopo && <button onClick={() => setTopoOpen(true)}>View topo</button>}
        </div>
      </div>
      {topoOpen && hasTopo && (
        <ClimbingTopoView topo={BIRDLAND_TOPO} routeName={route.name} onClose={() => setTopoOpen(false)} />
      )}
    </>
  )
}
