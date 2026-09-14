import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'

/**
 * Calls onPick(lat, lon) when the map is double-clicked, for as long as the
 * calling component is mounted — replacing Cesium's default double-click
 * (track entity). Uses scene.pickPosition (the actual rendered terrain
 * surface from the depth buffer) rather than pickEllipsoid, which
 * intersects the flat WGS84 ellipsoid and drifts badly over elevated
 * terrain at tilted camera angles.
 */
export function useDoubleClickPick(viewer: Cesium.Viewer | null, onPick: (lat: number, lon: number) => void) {
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  useEffect(() => {
    if (!viewer) return
    const handler = viewer.screenSpaceEventHandler
    const previousAction = handler.getInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const cartesian = viewer.scene.pickPositionSupported
        ? viewer.scene.pickPosition(movement.position)
        : viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid)
      if (!cartesian) return
      const carto = Cesium.Cartographic.fromCartesian(cartesian)
      onPickRef.current(Cesium.Math.toDegrees(carto.latitude), Cesium.Math.toDegrees(carto.longitude))
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

    return () => {
      if (previousAction) {
        handler.setInputAction(previousAction, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
      } else {
        handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)
      }
    }
  }, [viewer])
}
