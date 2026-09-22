import * as Cesium from 'cesium'
import { PbfReader } from 'pbf'
import { VectorTile } from '@mapbox/vector-tile'

// MapTiler publishes contour lines only as vector tiles (no pre-rendered
// raster version exists, unlike the "outdoor"/"backdrop" styles) — so
// unlike place-name labels, this draws real MapTiler elevation-line data
// into plain raster tiles ourselves. This is safe to do for lines (unlike
// icons/text) because lines are meant to lie flat and follow the terrain
// exactly like any other imagery layer here — there's no "stay upright
// toward the camera" requirement the way point labels have, so there's no
// warping risk to reproduce.
const CONTOURS_URL_TEMPLATE = 'https://api.maptiler.com/tiles/contours-v2/{z}/{x}/{y}.pbf'
const MIN_DATA_ZOOM = 9
const MAX_DATA_ZOOM = 14
const TILE_SIZE = 512

// "nth_line" marks periodic index contours (every 5th/10th line) the same
// way a printed topo map bolds them for readability among the regular ones.
const INDEX_LINE_THRESHOLD = 5

/**
 * Renders MapTiler's contour-line vector tiles (elevation isolines) as
 * plain transparent-background raster tiles, for use as a normal Cesium
 * imagery overlay. Vector tiles are fetched and decoded per Cesium tile
 * request — no different in kind from how any other custom imagery source
 * works, just drawing lines instead of returning pixels from a server.
 */
export class ContourImageryProvider {
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

    if (level < MIN_DATA_ZOOM) return canvas // no contour data this far out — leave blank

    const url = `${CONTOURS_URL_TEMPLATE.replace('{z}', String(level)).replace('{x}', String(x)).replace('{y}', String(y))}?key=${this.key}`

    try {
      const res = await fetch(url)
      if (!res.ok) return canvas // e.g. an ocean tile with no contour data at all
      const buf = await res.arrayBuffer()
      const tile = new VectorTile(new PbfReader(new Uint8Array(buf)))
      const layer = tile.layers.contour
      if (!layer) return canvas

      const ctx = canvas.getContext('2d')
      if (!ctx) return canvas

      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i)
        const scale = TILE_SIZE / layer.extent
        const isIndex = Number(feature.properties.nth_line ?? 0) >= INDEX_LINE_THRESHOLD

        ctx.strokeStyle = isIndex ? 'rgba(120, 72, 28, 0.85)' : 'rgba(120, 72, 28, 0.5)'
        ctx.lineWidth = isIndex ? 1.6 : 0.8
        ctx.beginPath()
        for (const path of feature.loadGeometry()) {
          path.forEach((point, idx) => {
            const px = point.x * scale
            const py = point.y * scale
            if (idx === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          })
        }
        ctx.stroke()
      }
    } catch {
      // Best-effort — a failed fetch/parse just leaves this tile blank
      // rather than breaking the rest of the overlay.
    }

    return canvas
  }
}
