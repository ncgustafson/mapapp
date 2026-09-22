import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { useCesiumViewer } from '../cesium/CesiumContext'
import { padRectangle } from '../places/placeLandmarks'
import { useRoutes } from './RouteContext'
import { KIND_COLORS, type LatLon, type RouteFeature } from './routeTypes'
import { buildTrailGraph, snapAndTrace, type TrailGraph } from './trailNetwork'

// How far to pad the current camera view when fetching the trail/road graph
// for a drawing session — generous enough that drawing slightly outside the
// exact visible area still has coverage.
const GRAPH_PADDING_FRACTION = 0.3
// mapContext's tile fetcher defaults to a 16-tile cap, sized for tiny
// per-segment queries (traceAlongTrails) and frequent agent tool calls. This
// fetch instead covers the whole padded camera viewport, once per drawing
// session — a zoomed-out view can easily span more than 16 tiles at
// FEATURE_ZOOM, and since tiles fill in only partially once the cap is hit,
// that silently left most of the visible area with no trail data to snap
// onto. A one-time per-session fetch can afford a much bigger budget.
const GRAPH_MAX_TILES = 96

function toCartesian(p: LatLon): Cesium.Cartesian3 {
  return Cesium.Cartesian3.fromDegrees(p.lon, p.lat)
}

function nameLabel(text: string): Cesium.LabelGraphics.ConstructorOptions {
  return {
    text,
    font: 'bold 13px system-ui, sans-serif',
    fillColor: Cesium.Color.WHITE,
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 3,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    pixelOffset: new Cesium.Cartesian2(0, -8),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  }
}

function buildSavedEntities(viewer: Cesium.Viewer, feature: RouteFeature): Cesium.Entity[] {
  const color = Cesium.Color.fromCssColorString(KIND_COLORS[feature.kind])
  const positions = feature.points.map(toCartesian)
  // Every entity belonging to a feature carries its id, so clicking any
  // part of it (the line, the fill, the label) resolves back to the same
  // route for selection.
  const properties = { routeId: feature.id }
  const show = feature.visible ?? true

  if (feature.kind === 'point') {
    return [
      viewer.entities.add({
        properties,
        show,
        position: positions[0],
        point: {
          pixelSize: 10,
          color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: { ...nameLabel(feature.name), pixelOffset: new Cesium.Cartesian2(0, -12) },
      }),
    ]
  }

  if (feature.kind === 'polygon') {
    return [
      viewer.entities.add({
        properties,
        show,
        polygon: {
          hierarchy: positions,
          material: color.withAlpha(0.25),
        },
      }),
      viewer.entities.add({
        properties,
        show,
        polyline: {
          positions: [...positions, positions[0]],
          width: 2,
          material: color,
          clampToGround: true,
          arcType: Cesium.ArcType.RHUMB,
        },
      }),
      viewer.entities.add({ properties, show, position: positions[0], label: nameLabel(feature.name) }),
    ]
  }

  return [
    viewer.entities.add({
      properties,
      show,
      polyline: { positions, width: 3, material: color, clampToGround: true, arcType: Cesium.ArcType.RHUMB },
    }),
    viewer.entities.add({ properties, show, position: positions[0], label: nameLabel(feature.name) }),
  ]
}

function pickedRouteId(viewer: Cesium.Viewer, position: Cesium.Cartesian2): string | null {
  const picked = viewer.scene.pick(position)
  const entity = picked?.id as Cesium.Entity | undefined
  if (!entity?.properties?.hasProperty('routeId')) return null
  const value = entity.properties.getValue(Cesium.JulianDate.now())
  return typeof value?.routeId === 'string' ? value.routeId : null
}

/**
 * Renders saved routes/points/polygons on the globe and handles the
 * click-to-draw interaction (lives inside MapView, alongside
 * PlaceLabelsLayer, so it shares the same viewer). RouteContext owns the
 * actual state; this only turns it into Cesium entities and feeds picked
 * positions back in.
 */
export function DrawingLayer() {
  const viewer = useCesiumViewer()
  const { routes, drawMode, draftPoints, addDraftPoint, finishDrawing, cancelDrawing, selectRoute } = useRoutes()

  const savedEntitiesRef = useRef<Map<string, Cesium.Entity[]>>(new Map())
  const draftPointsRef = useRef<LatLon[]>(draftPoints)
  // Trail/road graph for the current drawing session's general area,
  // fetched once when drawing starts and reused for every snap/trace
  // after that — see trailNetwork.ts's buildTrailGraph/snapAndTrace. This
  // is what makes a *live* per-frame preview possible at all: with the
  // network data already in memory, snapping is just local graph math, no
  // per-mouse-move network fetch.
  const trailGraphRef = useRef<TrailGraph | null>(null)
  // Trail-traced version of the clicked-so-far points (not the live cursor
  // segment — see hoverTracedRef for that), kept separate from draftPoints
  // (raw clicks) since it fills in with real trail geometry between them.
  const tracedPreviewRef = useRef<LatLon[]>(draftPoints)
  // Traced path from the last committed click to the live cursor position
  // — recomputed on every mouse-move using the already-cached graph so the
  // dashed "next segment" also follows a nearby trail before you click,
  // not just after.
  const hoverTracedRef = useRef<LatLon[]>([])
  const drawModeRef = useRef(drawMode)
  const cursorRef = useRef<Cesium.Cartesian3 | null>(null)
  const draftVertexEntitiesRef = useRef<Cesium.Entity[]>([])
  const draftLineEntityRef = useRef<Cesium.Entity | null>(null)
  // Click handling is wired up once and reads these refs each time, rather
  // than depending on (and re-subscribing for) every function/state change —
  // addDraftPoint etc. are fresh closures every render.
  const callbacksRef = useRef({ addDraftPoint, cancelDrawing, finishDrawing, selectRoute })

  draftPointsRef.current = draftPoints
  drawModeRef.current = drawMode
  callbacksRef.current = { addDraftPoint, cancelDrawing, finishDrawing, selectRoute }

  // Recomputes the committed (clicked-so-far) traced path using whatever
  // graph is currently cached — called both when draftPoints changes and
  // when the graph itself finishes loading, since either can make this
  // stale (e.g. clicking fast before the initial graph fetch resolves).
  function recomputeCommittedTrace() {
    const points = draftPointsRef.current
    const graph = trailGraphRef.current
    if (points.length < 2 || !graph) {
      tracedPreviewRef.current = points
      return
    }
    const result: LatLon[] = [points[0]]
    for (let i = 1; i < points.length; i++) {
      result.push(...snapAndTrace(graph, points[i - 1], points[i]).slice(1))
    }
    tracedPreviewRef.current = result
  }

  // Saved routes — add/remove entities as the list changes, and keep
  // existing ones' visibility in sync without rebuilding their geometry.
  useEffect(() => {
    if (!viewer) return
    const current = savedEntitiesRef.current
    const currentIds = new Set(routes.map((r) => r.id))

    for (const [id, entities] of current) {
      if (!currentIds.has(id)) {
        for (const e of entities) viewer.entities.remove(e)
        current.delete(id)
      }
    }
    for (const feature of routes) {
      const existing = current.get(feature.id)
      if (!existing) {
        current.set(feature.id, buildSavedEntities(viewer, feature))
        continue
      }
      const show = feature.visible ?? true
      for (const e of existing) e.show = show
    }
  }, [viewer, routes])

  // Draft vertex markers — one small dot per clicked-so-far point.
  useEffect(() => {
    if (!viewer) return
    for (const e of draftVertexEntitiesRef.current) viewer.entities.remove(e)
    draftVertexEntitiesRef.current = draftPoints.map((p) =>
      viewer.entities.add({
        position: toCartesian(p),
        point: {
          pixelSize: 8,
          color: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString(drawMode ? KIND_COLORS[drawMode] : '#ffffff'),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    )
  }, [viewer, draftPoints, drawMode])

  // Fetch the trail/road graph once per drawing session (not per click, not
  // per frame) — covers the current camera view, padded. A route drawn
  // well outside this area just won't have anything to snap to (falls back
  // to straight lines), same as if there's no trail data at all nearby.
  useEffect(() => {
    trailGraphRef.current = null
    if (!viewer || (drawMode !== 'line' && drawMode !== 'polygon')) return

    let cancelled = false
    const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid)
    if (!rectangle) return
    const padded = padRectangle(rectangle, GRAPH_PADDING_FRACTION)

    buildTrailGraph(
      {
        west: Cesium.Math.toDegrees(padded.west),
        south: Cesium.Math.toDegrees(padded.south),
        east: Cesium.Math.toDegrees(padded.east),
        north: Cesium.Math.toDegrees(padded.north),
      },
      GRAPH_MAX_TILES,
    )
      .then((graph) => {
        if (cancelled) return
        trailGraphRef.current = graph
        recomputeCommittedTrace()
      })
      .catch(() => {
        // Best-effort — drawing still works without snapping.
      })

    return () => {
      cancelled = true
    }
  }, [viewer, drawMode])

  // Re-trace the committed clicks whenever a new one is added.
  useEffect(() => {
    recomputeCommittedTrace()
  }, [draftPoints])

  // Rubber-band preview: traced clicked-so-far points + a traced segment
  // from the last click to the live cursor, updated every frame via
  // CallbackProperty rather than React state (so dragging the mouse
  // doesn't trigger a re-render per pixel) — the trace itself is computed
  // in the mouse-move handler below, not here, so this stays cheap.
  useEffect(() => {
    if (!viewer) return
    if (drawMode !== 'line' && drawMode !== 'polygon') return

    const entity = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          const pts = tracedPreviewRef.current.map(toCartesian)
          if (hoverTracedRef.current.length > 1) {
            pts.push(...hoverTracedRef.current.slice(1).map(toCartesian))
          } else if (cursorRef.current) {
            pts.push(cursorRef.current)
          }
          // Polygon-closing check uses the raw click count, not the traced
          // point count — the traced path can have far more points than
          // clicks, which would otherwise trigger this after only 1-2 clicks.
          if (drawModeRef.current === 'polygon' && draftPointsRef.current.length > 2) pts.push(pts[0])
          return pts
        }, false),
        width: 3,
        material: Cesium.Color.RED,
        clampToGround: true,
        arcType: Cesium.ArcType.RHUMB,
      },
    })
    draftLineEntityRef.current = entity

    return () => {
      viewer.entities.remove(entity)
      draftLineEntityRef.current = null
    }
  }, [viewer, drawMode])

  // Click either adds a draft point (while drawing) or picks/selects a
  // saved route (otherwise) — set up once and permanently takes over
  // left-click, rather than restoring Cesium's own default entity-select
  // behavior, since we want our own popup instead of Cesium's (disabled)
  // info box. Mouse-move drives the rubber-band preview (and, while
  // drawing, the live snapped-hover trace) while drawing. Enter/Escape
  // finish or cancel a draw, or close the popup/deselect.
  useEffect(() => {
    if (!viewer) return

    const handler = viewer.screenSpaceEventHandler

    function pickGround(position: Cesium.Cartesian2): LatLon | null {
      const cartesian = viewer!.scene.pickPositionSupported
        ? viewer!.scene.pickPosition(position)
        : viewer!.camera.pickEllipsoid(position, viewer!.scene.globe.ellipsoid)
      if (!cartesian) return null
      const carto = Cesium.Cartographic.fromCartesian(cartesian)
      return { lat: Cesium.Math.toDegrees(carto.latitude), lon: Cesium.Math.toDegrees(carto.longitude) }
    }

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      if (drawModeRef.current) {
        const point = pickGround(movement.position)
        if (point) callbacksRef.current.addDraftPoint(point)
        return
      }
      callbacksRef.current.selectRoute(pickedRouteId(viewer!, movement.position))
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (!drawModeRef.current) return
      const cartesian = viewer!.scene.pickPositionSupported
        ? (viewer!.scene.pickPosition(movement.endPosition) ?? null)
        : (viewer!.camera.pickEllipsoid(movement.endPosition, viewer!.scene.globe.ellipsoid) ?? null)
      cursorRef.current = cartesian

      const lastPoint = draftPointsRef.current[draftPointsRef.current.length - 1]
      const graph = trailGraphRef.current
      if (!cartesian || !lastPoint) {
        hoverTracedRef.current = []
        return
      }
      const carto = Cesium.Cartographic.fromCartesian(cartesian)
      const cursorLatLon = { lat: Cesium.Math.toDegrees(carto.latitude), lon: Cesium.Math.toDegrees(carto.longitude) }
      hoverTracedRef.current = graph ? snapAndTrace(graph, lastPoint, cursorLatLon) : [lastPoint, cursorLatLon]
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        callbacksRef.current.cancelDrawing()
        callbacksRef.current.selectRoute(null)
      } else if (e.key === 'Enter') {
        callbacksRef.current.finishDrawing()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
      handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE)
      window.removeEventListener('keydown', onKeyDown)
      cursorRef.current = null
      hoverTracedRef.current = []
    }
  }, [viewer])

  // Full teardown on unmount.
  useEffect(() => {
    return () => {
      if (!viewer) return
      for (const entities of savedEntitiesRef.current.values()) {
        for (const e of entities) viewer.entities.remove(e)
      }
      for (const e of draftVertexEntitiesRef.current) viewer.entities.remove(e)
      if (draftLineEntityRef.current) viewer.entities.remove(draftLineEntityRef.current)
    }
  }, [viewer])

  return null
}
