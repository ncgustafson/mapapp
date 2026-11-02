import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { useCesiumViewer } from '../cesium/CesiumContext'
import { useClimbing } from './ClimbingContext'
import type { ClimbingRoute } from './openbeta'

// Distinct from the hiking-route palette (routeTypes.ts KIND_COLORS) so the
// two feature types read as clearly different things on the globe.
const CLIMBING_COLOR = Cesium.Color.fromCssColorString('#c084fc')

/**
 * Every route on a wall shares one coordinate (OpenBeta has no finer-grained
 * location data — see openbeta.ts). Entities are clustered (see below) by
 * on-screen pixel distance, which only works if same-wall markers have some
 * real separation to begin with — zoomed out, a few meters collapses to
 * sub-pixel and they cluster into one bubble; zoomed in, those same meters
 * span enough pixels to split back into individual pins. This spread is
 * purely that mechanism, not an implication of real per-route precision.
 *
 * `height` must be real terrain height, not 0 — a clustered marker is drawn
 * via Cesium's low-level point/label primitives (not full entity graphics),
 * which have no `heightReference`/clamp-to-ground support, unlike a normal
 * entity's point graphics. Baking the real height into the position itself
 * is the only way a cluster ends up on the visible surface instead of
 * underground (ellipsoid height 0 sits ~1300m below actual ground here).
 */
function jitteredPosition(route: ClimbingRoute, height: number, indexInGroup: number, groupSize: number): Cesium.Cartesian3 {
  const base = Cesium.Cartesian3.fromDegrees(route.lon, route.lat, height)
  if (groupSize <= 1) return base
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(base)
  const angle = (indexInGroup / groupSize) * 2 * Math.PI
  const radius = 6 + Math.min(groupSize, 20) * 0.6
  const local = new Cesium.Cartesian3(radius * Math.cos(angle), radius * Math.sin(angle), 0)
  return Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3())
}

function groupByWallCoordinate(routes: ClimbingRoute[]): Map<string, ClimbingRoute[]> {
  const groups = new Map<string, ClimbingRoute[]>()
  for (const route of routes) {
    const key = `${route.lat.toFixed(5)},${route.lon.toFixed(5)}`
    const group = groups.get(key)
    if (group) group.push(route)
    else groups.set(key, [route])
  }
  return groups
}

/**
 * Renders a marker per climbing route on the globe, clustered by on-screen
 * proximity (Cesium's built-in entity clustering) so a wall with a few
 * dozen routes reads as one "N routes" bubble zoomed out, and splits into
 * individual pins as you zoom toward it. Mounted inside MapView alongside
 * DrawingLayer — click picking for both single markers and clusters is
 * handled there (it already owns the single LEFT_CLICK handler Cesium
 * allows per event type; see the `climbId` property / array-of-entities
 * checks in DrawingLayer).
 */
export function ClimbingLayer() {
  const viewer = useCesiumViewer()
  const { routes } = useClimbing()
  const dataSourceRef = useRef<Cesium.CustomDataSource | null>(null)

  useEffect(() => {
    if (!viewer) return

    const dataSource = new Cesium.CustomDataSource('climbing-routes')
    viewer.dataSources.add(dataSource)
    dataSource.clustering.enabled = true
    dataSource.clustering.pixelRange = 55
    dataSource.clustering.minimumClusterSize = 2

    const removeClusterListener = dataSource.clustering.clusterEvent.addEventListener((clusteredEntities, cluster) => {
      const wallNames = new Set(
        clusteredEntities
          .map((e) => (e.properties?.hasProperty('wallName') ? e.properties.getValue(Cesium.JulianDate.now())?.wallName : null))
          .filter((name): name is string => typeof name === 'string'),
      )
      const count = clusteredEntities.length
      const title = wallNames.size === 1 ? [...wallNames][0] : `${wallNames.size} walls`
      const subtitle = `${count} route${count === 1 ? '' : 's'}`

      cluster.billboard.show = false
      cluster.point.show = true
      cluster.point.pixelSize = 14 + Math.min(count, 30)
      cluster.point.color = CLIMBING_COLOR
      cluster.point.outlineColor = Cesium.Color.WHITE
      cluster.point.outlineWidth = 2
      cluster.point.disableDepthTestDistance = Number.POSITIVE_INFINITY

      cluster.label.show = true
      cluster.label.text = `${title}\n${subtitle}`
      cluster.label.font = 'bold 13px system-ui, sans-serif'
      cluster.label.fillColor = Cesium.Color.WHITE
      cluster.label.outlineColor = Cesium.Color.BLACK
      cluster.label.outlineWidth = 3
      cluster.label.style = Cesium.LabelStyle.FILL_AND_OUTLINE
      // Sits above the bubble rather than overlapping its count-sized dot.
      cluster.label.verticalOrigin = Cesium.VerticalOrigin.BOTTOM
      cluster.label.pixelOffset = new Cesium.Cartesian2(0, -(cluster.point.pixelSize / 2 + 6))
      // Same depth-test fix as the point above — without this the label is
      // occluded by terrain even once the position itself is correct.
      cluster.label.disableDepthTestDistance = Number.POSITIVE_INFINITY
    })

    dataSourceRef.current = dataSource
    return () => {
      removeClusterListener()
      viewer.dataSources.remove(dataSource, true)
      dataSourceRef.current = null
    }
  }, [viewer])

  useEffect(() => {
    const dataSource = dataSourceRef.current
    if (!dataSource || !viewer || routes.length === 0) return

    let cancelled = false
    const groups = groupByWallCoordinate(routes)

    // One terrain sample per unique wall coordinate (not per route) — see
    // jitteredPosition's comment for why this needs to be real height.
    const uniqueGroups = [...groups.values()]
    const cartographics = uniqueGroups.map((group) => Cesium.Cartographic.fromDegrees(group[0].lon, group[0].lat))

    Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographics)
      .catch(() => cartographics)
      .then((sampled) => {
        if (cancelled) return
        dataSource.entities.removeAll()
        uniqueGroups.forEach((group, groupIndex) => {
          const height = sampled[groupIndex]?.height ?? 0
          group.forEach((route, i) => {
            dataSource.entities.add({
              properties: { climbId: route.id, wallName: route.wallName },
              position: jitteredPosition(route, height, i, group.length),
              point: {
                pixelSize: 8,
                color: CLIMBING_COLOR,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 1.5,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            })
          })
        })
        // Re-triggers clustering with the refreshed entity set — clustering
        // doesn't automatically recompute just because entities changed.
        dataSource.clustering.enabled = false
        dataSource.clustering.enabled = true
      })

    return () => {
      cancelled = true
    }
  }, [viewer, routes])

  return null
}
