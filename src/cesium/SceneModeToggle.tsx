import { useState } from 'react'
import * as Cesium from 'cesium'
import { useCesiumViewer } from './CesiumContext'

// Cesium's real scene-mode morph (morphTo2D/morphTo3D — a full switch to an
// orthographic projection, with the whole globe visibly unrolling flat) was
// tried here first and felt way too drastic for what's really wanted: just
// a quick way to look straight down vs. the normal tilted view. This stays
// in SCENE3D the whole time and only pivots the camera's pitch around
// whatever point is currently at the center of the screen — so terrain,
// drawing, and every imagery overlay keep behaving exactly as they always
// do, and the transition is a plain, gentle camera move.
// Not exactly -90: straight-down pitch is a singularity for Cesium's
// tilt-drag math (heading/pitch decomposition breaks down there), which
// left Shift+drag unable to tilt back out of the 2D view once in it. -89.9
// still reads as straight down but stays just off the singularity.
const TOP_DOWN_PITCH_DEG = -89.9
const TILTED_PITCH_DEG = -35
const FLY_DURATION_SECONDS = 0.8

function currentLookAtPoint(viewer: Cesium.Viewer): Cesium.Cartesian3 {
  const canvas = viewer.scene.canvas
  const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2)
  const picked = viewer.scene.pickPositionSupported
    ? viewer.scene.pickPosition(center)
    : viewer.camera.pickEllipsoid(center, viewer.scene.globe.ellipsoid)
  if (picked) return picked
  // Fallback if nothing's under the screen center to pick (e.g. looking at
  // open sky) — straight down from the camera's current ground position.
  const carto = viewer.camera.positionCartographic
  return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0)
}

export function SceneModeToggle() {
  const viewer = useCesiumViewer()
  const [topDown, setTopDown] = useState(false)

  if (!viewer) return null

  function setMode(wantTopDown: boolean) {
    if (!viewer || wantTopDown === topDown) return
    const target = currentLookAtPoint(viewer)
    const range = Cesium.Cartesian3.distance(viewer.camera.positionWC, target)
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 1), {
      offset: new Cesium.HeadingPitchRange(
        viewer.camera.heading,
        Cesium.Math.toRadians(wantTopDown ? TOP_DOWN_PITCH_DEG : TILTED_PITCH_DEG),
        range,
      ),
      duration: FLY_DURATION_SECONDS,
    })
    setTopDown(wantTopDown)
  }

  return (
    <div className="scene-mode-toggle">
      <button className={topDown ? 'active' : ''} onClick={() => setMode(true)}>
        2D
      </button>
      <button className={topDown ? '' : 'active'} onClick={() => setMode(false)}>
        3D
      </button>
    </div>
  )
}
