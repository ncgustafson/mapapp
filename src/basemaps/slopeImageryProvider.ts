import * as Cesium from 'cesium'

// MapTiler's Terrain-RGB tiles encode elevation directly into pixel color
// (Mapbox's standard terrain-RGB scheme: meters = -10000 + (R*65536 +
// G*256 + B) * 0.1) — verified directly against a real tile over Paradise,
// Mt Rainier (decoded elevations ~1300-1700m, matching the real terrain
// there). Confirmed available from z0 through z14 (z15 404s), 512x512 webp
// tiles regardless of the .png/.webp extension requested.
const TERRAIN_RGB_URL_TEMPLATE = 'https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp'
// Below this the underlying DEM resolution is too coarse for slope angle to
// mean much, and it's a lot of pixel math to spend on a layer that isn't
// telling you anything useful yet.
const MIN_DATA_ZOOM = 8
const MAX_DATA_ZOOM = 14
const TILE_SIZE = 512
// Earth's mean radius for the standard spherical Web Mercator approximation
// — good enough for a slope estimate, not for surveying.
const EARTH_RADIUS_METERS = 6378137

// Avalanche-terrain-style slope angle shading, in the spirit of CalTopo's
// slope layer — banded by steepness, since that's the meaningful grouping
// (most avalanches release on 30-45° slopes) rather than a smooth gradient.
// Under 27° is left fully transparent: not meaningfully avalanche terrain,
// and leaving it clear keeps the rest of the map legible underneath.
const SLOPE_BANDS: { belowDeg: number; rgba: [number, number, number, number] }[] = [
  { belowDeg: 27, rgba: [0, 0, 0, 0] },
  { belowDeg: 30, rgba: [255, 255, 0, 44] },
  { belowDeg: 32, rgba: [255, 208, 0, 54] },
  { belowDeg: 35, rgba: [255, 160, 0, 64] },
  { belowDeg: 40, rgba: [255, 90, 0, 77] },
  { belowDeg: 45, rgba: [230, 20, 20, 87] },
  { belowDeg: 50, rgba: [170, 0, 60, 97] },
  { belowDeg: Infinity, rgba: [120, 0, 130, 110] },
]

function colorForSlopeDeg(deg: number): [number, number, number, number] {
  for (const band of SLOPE_BANDS) {
    if (deg < band.belowDeg) return band.rgba
  }
  return SLOPE_BANDS[SLOPE_BANDS.length - 1].rgba
}

function elevationFromRgb(r: number, g: number, b: number): number {
  return -10000 + (r * 256 * 256 + g * 256 + b) * 0.1
}

// A flat alpha-blended color wash reads as flat — real terrain texture
// (ridges catching light, gullies in shadow) is what makes a slope layer
// look like it's actually sitting on the terrain instead of painted over
// it. Standard hillshade (ESRI/GDAL "Horn" formula) computed from the same
// elevation gradient already being used for the slope angle itself, at the
// classic 315°/45° (NW, 45° up) light — same convention most relief maps
// use, CalTopo's default included.
const LIGHT_AZIMUTH_DEG = 315
const LIGHT_ALTITUDE_DEG = 45
const ZENITH_RAD = Cesium.Math.toRadians(90 - LIGHT_ALTITUDE_DEG)
const AZIMUTH_RAD = Cesium.Math.toRadians(((360 - LIGHT_AZIMUTH_DEG + 90) % 360))

// dzdx: eastward-positive elevation gradient. dzdy: south-positive (this
// file's pixel-row convention — row index increases southward). Returns a
// 0-1 shading factor (0 = fully shadowed, 1 = fully lit).
function hillshadeFactor(dzdx: number, dzdy: number): number {
  const northGrad = -dzdy
  const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + northGrad * northGrad))
  let aspectRad = Math.atan2(northGrad, -dzdx)
  if (aspectRad < 0) aspectRad += 2 * Math.PI

  const shade = Math.cos(ZENITH_RAD) * Math.cos(slopeRad) + Math.sin(ZENITH_RAD) * Math.sin(slopeRad) * Math.cos(AZIMUTH_RAD - aspectRad)
  return Math.max(0, Math.min(1, shade))
}

/**
 * Renders a slope-angle-shaded overlay from MapTiler's terrain-RGB elevation
 * tiles: decodes real elevation per pixel, estimates slope via a central
 * difference against neighboring pixels (one-sided at tile edges), and
 * colors each pixel by steepness band. Same shape as ContourImageryProvider
 * — a plain raster tile computed on the fly instead of returned by a server,
 * composited like any other Cesium imagery layer.
 */
export class SlopeImageryProvider {
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

    if (level < MIN_DATA_ZOOM) return canvas // too coarse to be meaningful — leave blank

    const url = `${TERRAIN_RGB_URL_TEMPLATE.replace('{z}', String(level)).replace('{x}', String(x)).replace('{y}', String(y))}?key=${this.key}`

    try {
      const res = await fetch(url)
      if (!res.ok) return canvas // e.g. an ocean tile with no elevation data at all
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

      // Real-world ground spacing between adjacent source pixels at this
      // tile's latitude/zoom — standard spherical Web Mercator resolution
      // formula, using the tile's own center latitude for the cos(lat)
      // distortion term.
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
          const slopeDeg = (Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180) / Math.PI

          const [r, g, b, a] = colorForSlopeDeg(slopeDeg)
          // Brightness swing around the band's flat color — dark side dips
          // toward shadow, bright side pushes toward highlight, so the
          // underlying terrain relief still reads through the color.
          const brightness = 0.55 + hillshadeFactor(dzdx, dzdy) * 0.9
          const o = (py * width + px) * 4
          out.data[o] = Math.min(255, r * brightness)
          out.data[o + 1] = Math.min(255, g * brightness)
          out.data[o + 2] = Math.min(255, b * brightness)
          out.data[o + 3] = a
        }
      }

      ctx.putImageData(out, 0, 0)
    } catch {
      // Best-effort — a failed fetch/decode just leaves this tile blank
      // rather than breaking the rest of the overlay.
    }

    return canvas
  }
}
