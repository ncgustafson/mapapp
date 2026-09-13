import * as Cesium from 'cesium'

export async function createViewer(container: HTMLDivElement): Promise<Cesium.Viewer> {
  const terrainProvider = await Cesium.createWorldTerrainAsync({
    requestVertexNormals: true,
  })

  const viewer = new Cesium.Viewer(container, {
    terrainProvider,
    baseLayerPicker: true,
    timeline: false,
    animation: false,
    geocoder: true,
    sceneModePicker: false,
    infoBox: false,
  })

  viewer.scene.globe.enableLighting = true
  viewer.scene.globe.depthTestAgainstTerrain = true

  // Replace the default Shift+drag "free look" (swivels camera in place,
  // feels jarring) with tilt — the same behavior already bound to Ctrl+drag.
  const cameraController = viewer.scene.screenSpaceCameraController
  cameraController.lookEventTypes = []
  cameraController.tiltEventTypes = [
    Cesium.CameraEventType.MIDDLE_DRAG,
    Cesium.CameraEventType.PINCH,
    { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL },
    { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.SHIFT },
  ]

  // Trackpad pinch-to-zoom: Chrome/Firefox already translate pinch into
  // Ctrl+wheel events, which Cesium's default zoom controls handle. Safari
  // instead fires non-standard "gesture" events (and uses them to zoom the
  // whole page), so wire those directly into the camera.
  const canvas = viewer.scene.canvas
  let lastGestureScale = 1
  canvas.addEventListener('gesturestart', (e: any) => {
    e.preventDefault()
    lastGestureScale = e.scale
  })
  canvas.addEventListener('gesturechange', (e: any) => {
    e.preventDefault()
    const delta = e.scale - lastGestureScale
    lastGestureScale = e.scale
    const amount = Math.abs(delta) * viewer.camera.positionCartographic.height * 0.5
    if (delta > 0) {
      viewer.camera.zoomIn(amount)
    } else {
      viewer.camera.zoomOut(amount)
    }
  })
  canvas.addEventListener('gestureend', (e: any) => {
    e.preventDefault()
  })

  // Default to an overview of Washington State
  viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(-124.85, 45.54, -116.92, 49.05),
  })

  return viewer
}
