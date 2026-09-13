import * as Cesium from 'cesium'

export function getMapCenter(viewer: Cesium.Viewer): { lat: number; lon: number } | null {
  const canvas = viewer.scene.canvas
  const screenCenter = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2)
  const cartesian = viewer.camera.pickEllipsoid(screenCenter, viewer.scene.globe.ellipsoid)
  if (!cartesian) return null
  const carto = Cesium.Cartographic.fromCartesian(cartesian)
  return { lat: Cesium.Math.toDegrees(carto.latitude), lon: Cesium.Math.toDegrees(carto.longitude) }
}
