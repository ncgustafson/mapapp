import * as Cesium from 'cesium'
import { ContourImageryProvider } from './contourImageryProvider'
import { HillshadeImageryProvider } from './hillshadeImageryProvider'
import { SlopeImageryProvider } from './slopeImageryProvider'

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined

export type BasemapDef = {
  id: string
  label: string
  description: string
  createProvider: () => Promise<Cesium.ImageryProvider>
  /** True when this basemap needs an API key that isn't configured yet. */
  disabled?: boolean
  /** CSS background (solid color or gradient) for its small preview swatch. */
  swatch: string
}

export type OverlayDef = {
  id: string
  label: string
  description: string
  createProvider: () => Promise<Cesium.ImageryProvider>
  swatch: string
}

// Base layers — mutually exclusive, one is always active.
export const BASEMAPS: BasemapDef[] = [
  {
    id: 'satellite',
    label: 'Satellite',
    // MapTiler's satellite imagery is meaningfully higher-resolution than
    // Esri's free layer in normal terrain (confirmed directly — individual
    // trees/buildings/driveways vs. a green blur at the same zoom over the
    // same spot). Falls back to Esri (no key needed) when no MapTiler key is
    // configured, so this basemap always works either way.
    description: MAPTILER_KEY
      ? 'MapTiler Satellite — high-resolution aerial/satellite imagery.'
      : 'Esri World Imagery — aerial/satellite photography. Add a MapTiler key (see Outdoor below) for meaningfully higher resolution.',
    createProvider: () =>
      MAPTILER_KEY
        ? Promise.resolve(
            new Cesium.UrlTemplateImageryProvider({
              url: `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`,
              credit: '© MapTiler',
            }),
          )
        : Cesium.ArcGisMapServerImageryProvider.fromUrl(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
          ),
    swatch: 'linear-gradient(135deg, #2f3d2a 0%, #1c2b45 60%, #0e1a2e 100%)',
  },
  {
    id: 'outdoor',
    label: 'Outdoor',
    description: MAPTILER_KEY
      ? 'MapTiler Outdoor — topo map with contour lines, trails, and hillshading.'
      : 'MapTiler Outdoor — needs a free API key. Get one at maptiler.com, then set VITE_MAPTILER_KEY in .env.',
    // MapTiler's raster export of their vector Outdoor style — confirmed
    // working directly (real contour lines, labeled peaks/wilderness
    // boundaries), and Cesium's imagery-layer pipeline only composites flat
    // raster tiles, not MapLibre-style vector tiles, so the raster export is
    // what makes this usable here at all.
    createProvider: () =>
      Promise.resolve(
        new Cesium.UrlTemplateImageryProvider({
          url: `https://api.maptiler.com/maps/outdoor-v2/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,
          credit: '© MapTiler © OpenStreetMap contributors',
        }),
      ),
    disabled: !MAPTILER_KEY,
    swatch: 'linear-gradient(135deg, #e4d6a7 0%, #9ab373 55%, #5c7a4a 100%)',
  },
  {
    id: 'topo-blank',
    label: 'Topo (no labels)',
    description: MAPTILER_KEY
      ? 'MapTiler Backdrop — hillshaded terrain relief with no place names, peak labels, or icons baked in. Useful since those labels warp/skew on tilted terrain here (see Outdoor above).'
      : 'MapTiler Backdrop — needs a free API key. Get one at maptiler.com, then set VITE_MAPTILER_KEY in .env.',
    createProvider: () =>
      Promise.resolve(
        new Cesium.UrlTemplateImageryProvider({
          url: `https://api.maptiler.com/maps/backdrop/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,
          credit: '© MapTiler © OpenStreetMap contributors',
        }),
      ),
    disabled: !MAPTILER_KEY,
    swatch: 'linear-gradient(135deg, #e8e8e8 0%, #b8b8b8 55%, #8a8a8a 100%)',
  },
  {
    id: 'opentopomap',
    label: 'OpenTopoMap',
    description:
      'OpenTopoMap — worldwide hiking-map style with contour lines, hillshading, and place-name labels, rendered independently of MapTiler. No API key needed. Labels are baked into the tiles, so — like Outdoor — text can warp on steeply tilted terrain.',
    // Confirmed working directly (real tile fetch, 200 PNG) — free, no key,
    // standard {s} subdomain round-robin like most open tile servers.
    createProvider: () =>
      Promise.resolve(
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
          subdomains: ['a', 'b', 'c'],
          maximumLevel: 17,
          credit: 'Kartendaten: © OpenStreetMap-Mitwirkende, SRTM | Kartendarstellung: © OpenTopoMap (CC-BY-SA)',
        }),
      ),
    swatch: 'linear-gradient(135deg, #f2e8cf 0%, #d9a35c 55%, #7a9e6e 100%)',
  },
]

// Overlays — any number can be active at once, drawn on top of the base
// layer.
export const OVERLAYS: OverlayDef[] = [
  {
    id: 'forest-roads',
    label: 'Forest Service Roads',
    description: 'USFS Motor Vehicle Use Map — designated forest roads and trails.',
    createProvider: () =>
      Cesium.ArcGisMapServerImageryProvider.fromUrl(
        'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer',
      ),
    swatch: 'linear-gradient(135deg, #c98a4b 0%, #8a5a2b 100%)',
  },
  {
    id: 'contours',
    label: 'Contour Lines',
    description: MAPTILER_KEY
      ? 'MapTiler elevation contours, drawn from their real line data — index lines bolder, like a printed topo map. Pairs well with "Topo (no labels)" or Satellite.'
      : 'MapTiler Contours — needs a free API key. Get one at maptiler.com, then set VITE_MAPTILER_KEY in .env.',
    createProvider: () => Promise.resolve(new ContourImageryProvider(MAPTILER_KEY ?? '') as unknown as Cesium.ImageryProvider),
    swatch: 'repeating-linear-gradient(135deg, #78481c, #78481c 2px, #e8e0cf 2px, #e8e0cf 6px)',
  },
  {
    id: 'hillshade',
    label: 'Hillshade',
    description: MAPTILER_KEY
      ? 'Relief shading computed from real terrain elevation — adds visible ridge/shadow texture under any base layer. Pairs well with Contour Lines for a fuller topo-map look.'
      : 'Hillshade — needs a free API key. Get one at maptiler.com, then set VITE_MAPTILER_KEY in .env.',
    createProvider: () => Promise.resolve(new HillshadeImageryProvider(MAPTILER_KEY ?? '') as unknown as Cesium.ImageryProvider),
    swatch: 'linear-gradient(135deg, #f2f2f2 0%, #9a9a9a 55%, #2b2b2b 100%)',
  },
  {
    id: 'slope-angle',
    label: 'Slope Angle',
    description: MAPTILER_KEY
      ? 'Avalanche-terrain-style slope shading, computed from real elevation data — transparent under 27°, yellow around 27-32°, orange 35-40°, red 40-45°, purple 50°+.'
      : 'Slope Angle Shading — needs a free API key. Get one at maptiler.com, then set VITE_MAPTILER_KEY in .env.',
    createProvider: () => Promise.resolve(new SlopeImageryProvider(MAPTILER_KEY ?? '') as unknown as Cesium.ImageryProvider),
    swatch: 'linear-gradient(135deg, #ffe066 0%, #ff8c00 40%, #e61414 70%, #780082 100%)',
  },
]

export const DEFAULT_BASEMAP_ID = 'satellite'
