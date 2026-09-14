import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { useCesiumViewer } from '../cesium/CesiumContext'
import {
  declutterPlacesByScreenSpace,
  fetchPlaceLandmarks,
  padRectangle,
  rectangleContains,
  type PlaceLandmark,
} from './placeLandmarks'

// Skip fetching new data above this view size — a whole-continent view
// would need an enormous, slow Overpass query. Whatever's already cached
// still gets shown/decluttered as usual.
const MAX_FETCH_AREA_DEG2 = 30
const PAD_FRACTION = 0.25
const DEBOUNCE_MS = 400
const MIN_PIXEL_DISTANCE = 70
// Cap how many rank-sorted candidates per category get projected/tested
// during decluttering — keeps the per-move cost bounded even once the
// cache holds thousands of landmarks from a long session.
const MAX_CANDIDATES_PER_KIND = 200

function buildEntityOptions(landmark: PlaceLandmark): Cesium.Entity.ConstructorOptions {
  const isCity = landmark.kind === 'city'
  return {
    position: Cesium.Cartesian3.fromDegrees(landmark.lon, landmark.lat),
    label: {
      text: landmark.name,
      font: `${isCity ? 'bold ' : ''}${isCity ? 14 : 12}px system-ui, sans-serif`,
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      verticalOrigin: Cesium.VerticalOrigin.TOP,
      pixelOffset: new Cesium.Cartesian2(0, 6),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    point: {
      pixelSize: isCity ? 6 : landmark.kind === 'peak' ? 5 : 4,
      color: isCity ? Cesium.Color.WHITE : landmark.kind === 'peak' ? Cesium.Color.SADDLEBROWN : Cesium.Color.DARKORANGE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 1,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  }
}

/**
 * Always-on place labels for the main map — cities, peaks, and mountain
 * passes, in the spirit of CalTopo's/Google Earth's native place labels.
 * Fetched landmarks are cached for the session (keyed by covering
 * rectangle) so re-visiting an area doesn't re-hit Overpass, and label
 * density automatically thins out when zoomed out via screen-space
 * decluttering (see placeLandmarks.ts).
 */
export function PlaceLabelsLayer() {
  const viewer = useCesiumViewer()

  const landmarksRef = useRef<Map<string, PlaceLandmark>>(new Map())
  const fetchedRegionsRef = useRef<Cesium.Rectangle[]>([])
  const entitiesRef = useRef<Map<string, Cesium.Entity>>(new Map())

  useEffect(() => {
    if (!viewer) return

    let debounceTimer: ReturnType<typeof setTimeout> | undefined
    let requestToken = 0
    let cancelled = false

    function updateEntities(target: PlaceLandmark[]) {
      const entities = entitiesRef.current
      const targetIds = new Set(target.map((t) => t.id))

      for (const [id, entity] of entities) {
        if (!targetIds.has(id)) {
          viewer!.entities.remove(entity)
          entities.delete(id)
        }
      }
      for (const landmark of target) {
        if (entities.has(landmark.id)) continue
        entities.set(landmark.id, viewer!.entities.add(buildEntityOptions(landmark)))
      }
    }

    function renderFromCache(rectangle: Cesium.Rectangle) {
      const visible = Array.from(landmarksRef.current.values()).filter((lm) =>
        Cesium.Rectangle.contains(rectangle, Cesium.Cartographic.fromDegrees(lm.lon, lm.lat)),
      )
      const byKind = (kind: PlaceLandmark['kind']) =>
        visible
          .filter((l) => l.kind === kind)
          .sort((a, b) => b.rank - a.rank)
          .slice(0, MAX_CANDIDATES_PER_KIND)

      const selected = declutterPlacesByScreenSpace(
        viewer!,
        [
          { items: byKind('city'), maxCount: 15 },
          { items: byKind('peak'), maxCount: 40 },
          { items: byKind('pass'), maxCount: 15 },
        ],
        MIN_PIXEL_DISTANCE,
      )

      updateEntities(selected)
    }

    async function update() {
      const token = ++requestToken
      const rectangle = viewer!.camera.computeViewRectangle(viewer!.scene.globe.ellipsoid)
      if (!rectangle) return

      // Render with whatever's already cached first — a slow or superseded
      // fetch should never leave the view stuck showing stale labels.
      renderFromCache(rectangle)

      const areaDeg2 = Cesium.Math.toDegrees(rectangle.width) * Cesium.Math.toDegrees(rectangle.height)
      if (areaDeg2 > MAX_FETCH_AREA_DEG2) return

      const alreadyCovered = fetchedRegionsRef.current.some((r) => rectangleContains(r, rectangle))
      if (alreadyCovered) return

      const padded = padRectangle(rectangle, PAD_FRACTION)
      try {
        const found = await fetchPlaceLandmarks(padded)
        if (cancelled || token !== requestToken) return
        for (const landmark of found) landmarksRef.current.set(landmark.id, landmark)
        fetchedRegionsRef.current.push(padded)
        renderFromCache(rectangle)
      } catch {
        // Best-effort — keep showing whatever's already cached.
      }
    }

    function onMoveEnd() {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(update, DEBOUNCE_MS)
    }

    viewer.camera.moveEnd.addEventListener(onMoveEnd)
    update()

    return () => {
      cancelled = true
      if (debounceTimer) clearTimeout(debounceTimer)
      viewer.camera.moveEnd.removeEventListener(onMoveEnd)
      for (const entity of entitiesRef.current.values()) {
        viewer.entities.remove(entity)
      }
      entitiesRef.current.clear()
    }
  }, [viewer])

  return null
}
