import * as Cesium from 'cesium'

const DEFAULT_HALF_DEG = 0.015

/** A small square draped on terrain, marking a point of interest on the map. */
export function addTerrainSquareMarker(
  viewer: Cesium.Viewer,
  lat: number,
  lon: number,
  halfDeg = DEFAULT_HALF_DEG,
): Cesium.Entity {
  const d = halfDeg
  return viewer.entities.add({
    rectangle: {
      coordinates: Cesium.Rectangle.fromDegrees(lon - d, lat - d, lon + d, lat + d),
      material: Cesium.Color.fromCssColorString('#22c55e').withAlpha(0.45),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString('#22c55e'),
      outlineWidth: 2,
      classificationType: Cesium.ClassificationType.TERRAIN,
    },
  })
}

/**
 * A ground-clamped border outlining a [west, south, east, north] bounding
 * box. Uses a polyline loop rather than a Rectangle's own outline — Cesium's
 * ground-clamped rectangles don't reliably render outlines on terrain.
 */
export function addTerrainBoundsBorder(
  viewer: Cesium.Viewer,
  bounds: [number, number, number, number],
  color = Cesium.Color.fromCssColorString('#facc15'),
): Cesium.Entity {
  const [west, south, east, north] = bounds
  const positions = Cesium.Cartesian3.fromDegreesArray([
    west, south, east, south, east, north, west, north, west, south,
  ])
  return viewer.entities.add({
    polyline: {
      positions,
      width: 3,
      material: color,
      clampToGround: true,
    },
  })
}
