import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'

const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined

if (!ionToken) {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <div style="font-family: sans-serif; padding: 2rem; max-width: 640px; margin: 0 auto;">
      <h1>Missing Cesium ion access token</h1>
      <p>Create a free token at <a href="https://ion.cesium.com/tokens" target="_blank">ion.cesium.com/tokens</a>,
      then create a <code>.env</code> file in the project root with:</p>
      <pre>VITE_CESIUM_ION_TOKEN=your_token_here</pre>
      <p>Restart the dev server after adding it.</p>
    </div>
  `
  throw new Error('Missing VITE_CESIUM_ION_TOKEN')
}

Cesium.Ion.defaultAccessToken = ionToken

async function main() {
  const terrainProvider = await Cesium.createWorldTerrainAsync({
    requestVertexNormals: true,
  })

  const viewer = new Cesium.Viewer('cesiumContainer', {
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

  // Start over the Tetons as a proof-of-concept mountain landscape
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(-110.8, 43.75, 15000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-30),
    },
  })
}

main()
