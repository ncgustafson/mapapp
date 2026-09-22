import * as Cesium from 'cesium'

// Same terrain-RGB source/encoding as SlopeImageryProvider (see that file
// for the verification against real elevation data) — this renders the
// shading alone as a soft relief overlay, meant to sit under Contour Lines
// on any base layer for the kind of terrain-textured "Topo" look CalTopo's
// bundled base layer has, rather than a flat basemap.
const TERRAIN_RGB_URL_TEMPLATE = 'https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp'
const MIN_DATA_ZOOM = 8
const MAX_DATA_ZOOM = 14
const TILE_SIZE = 512
const EARTH_RADIUS_METERS = 6378137

const LIGHT_AZIMUTH_DEG = 315
const LIGHT_ALTITUDE_DEG = 45
const ZENITH_RAD = Cesium.Math.toRadians(90 - LIGHT_ALTITUDE_DEG)
const AZIMUTH_RAD = Cesium.Math.toRadians((360 - LIGHT_AZIMUTH_DEG + 90) % 360)
// Moderate constant alpha — this is meant to add relief texture under
// whatever base layer/contours are already showing, not dominate them.
const OVERLAY_ALPHA = 110

function elevationFromRgb(r: number, g: number, b: number): number {
  return -10000 + (r * 256 * 256 + g * 256 + b) * 0.1
}

function hillshadeFactor(dzdx: number, dzdy: number): number {
  const northGrad = -dzdy
  const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + northGrad * northGrad))
  let aspectRad = Math.atan2(northGrad, -dzdx)
  if (aspectRad < 0) aspectRad += 2 * Math.PI

  const shade = Math.cos(ZENITH_RAD) * Math.cos(slopeRad) + Math.sin(ZENITH_RAD) * Math.sin(slopeRad) * Math.cos(AZIMUTH_RAD - aspectRad)
  return Math.max(0, Math.min(1, shade))
}

/** Pure relief-shading overlay computed from real terrain elevation — see
 * SlopeImageryProvider for the same technique applied to slope-angle bands. */
export class HillshadeImageryProvider {
  readonly tileWidth = TILE_SIZE
  readonly tileHeight = TILE_SIZE
  readonly minimumLevel = 0
  readonly maximumLevel = MAX_DATA_ZOOM
  readonly tilingScheme = new Cesium.WebMercatorTilingScheme()
  readonly rectangle: Cesium.Rectangle
  readonly tileDiscardPolicy = undefined
  readonly errorEvent = new Cesium.Event()
  readonly credit: Cesium.Credit
  readonly proxy = undefined
  readonly hasAlphaChannel = true

  private readonly key: string

  constructor(key: string) {
    this.key = key
    this.rectangle = this.tilingScheme.rectangle
    this.credit = new Cesium.Credit('© MapTiler')
  }

  getTileCredits(): Cesium.Credit[] {
    return [this.credit]
  }

  async requestImage(x: number, y: number, level: number): Promise<HTMLCanvasElement> {
    const canvas = document.createElement('canvas')
    canvas.width = TILE_SIZE
    canvas.height = TILE_SIZE

    if (level < MIN_DATA_ZOOM) return canvas

    const url = `${TERRAIN_RGB_URL_TEMPLATE.replace('{z}', String(level)).replace('{x}', String(x)).replace('{y}', String(y))}?key=${this.key}`

    try {
      const res = await fetch(url)
      if (!res.ok) return canvas
      const bitmap = await createImageBitmap(await res.blob())

      const srcCanvas = document.createElement('canvas')
      srcCanvas.width = bitmap.width
      srcCanvas.height = bitmap.height
      const srcCtx = srcCanvas.getContext('2d')
      if (!srcCtx) return canvas
      srcCtx.drawImage(bitmap, 0, 0)
      const { data, width, height } = srcCtx.getImageData(0, 0, bitmap.width, bitmap.height)

      const elevations = new Float32Array(width * height)
      for (let i = 0; i < width * height; i++) {
        const o = i * 4
        elevations[i] = elevationFromRgb(data[o], data[o + 1], data[o + 2])
      }

      const tileRect = this.tilingScheme.tileXYToRectangle(x, y, level)
      const centerLat = (tileRect.north + tileRect.south) / 2
      const metersPerPixel = (2 * Math.PI * EARTH_RADIUS_METERS * Math.cos(centerLat)) / (width * 2 ** level)

      const ctx = canvas.getContext('2d')
      if (!ctx) return canvas
      const out = ctx.createImageData(width, height)

      for (let py = 0; py < height; py++) {
        const yTop = py > 0 ? py - 1 : py
        const yBottom = py < height - 1 ? py + 1 : py
        const dyPixels = yBottom - yTop || 1
        for (let px = 0; px < width; px++) {
          const xLeft = px > 0 ? px - 1 : px
          const xRight = px < width - 1 ? px + 1 : px
          const dxPixels = xRight - xLeft || 1

          const dzdx = (elevations[py * width + xRight] - elevations[py * width + xLeft]) / (dxPixels * metersPerPixel)
          const dzdy = (elevations[yBottom * width + px] - elevations[yTop * width + px]) / (dyPixels * metersPerPixel)
          const shade = hillshadeFactor(dzdx, dzdy)

          // Neutral (flat, shade ~0.7 under this light) sits near mid-gray
          // and nearly transparent; shadowed terrain darkens toward black,
          // lit terrain brightens toward white — a classic "multiply-style"
          // relief look without needing an actual blend mode.
          const gray = Math.round(shade * 255)
          const alpha = Math.round(OVERLAY_ALPHA * (1 - shade * 0.35))
          const o = (py * width + px) * 4
          out.data[o] = gray
          out.data[o + 1] = gray
          out.data[o + 2] = gray
          out.data[o + 3] = alpha
        }
      }

      ctx.putImageData(out, 0, 0)
    } catch {
      // Best-effort — a failed fetch/decode just leaves this tile blank.
    }

    return canvas
  }
}
