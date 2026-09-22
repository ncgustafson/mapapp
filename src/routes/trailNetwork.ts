import * as Cesium from 'cesium'
import { fetchNetworkGeometry, type Bounds } from './mapContext'
import type { LatLon } from './routeTypes'

// Vertices within this distance are treated as the same junction — merges
// tile-boundary floating-point mismatches (adjacent vector tiles can encode
// the same real junction with slightly different coordinates) without
// requiring exact matches.
const MERGE_EPSILON_METERS = 8
// How close a waypoint must be to the network to snap onto it at all.
// Generous enough to forgive an imprecise click, tight enough that a
// deliberately-off-trail point doesn't get dragged onto a nearby trail.
const SNAP_THRESHOLD_METERS = 60
// Bounding box padding around each waypoint pair when fetching the local
// network — real trails/roads occasionally bow outside the direct
// point-to-point box.
const PADDING_DEGREES = 0.01

type NodeId = number
export type TrailGraph = { positions: LatLon[]; adjacency: Map<NodeId, Map<NodeId, number>> }

function distanceMeters(a: LatLon, b: LatLon): number {
  const geodesic = new Cesium.EllipsoidGeodesic(
    Cesium.Cartographic.fromDegrees(a.lon, a.lat),
    Cesium.Cartographic.fromDegrees(b.lon, b.lat),
  )
  return geodesic.surfaceDistance
}

function boundsAround(points: LatLon[], padding: number): Bounds {
  const lats = points.map((p) => p.lat)
  const lons = points.map((p) => p.lon)
  return {
    west: Math.min(...lons) - padding,
    south: Math.min(...lats) - padding,
    east: Math.max(...lons) + padding,
    north: Math.max(...lats) + padding,
  }
}

/** Groups nearby points into a shared node id via a coarse lat/lon grid, so
 * merge lookups only compare against points in the same or an adjacent
 * cell instead of scanning every node built so far. */
class SpatialIndex {
  private buckets = new Map<string, NodeId[]>()
  private positions: LatLon[]
  private cellLat: number
  private cellLon: number

  constructor(positions: LatLon[], refLat: number) {
    this.positions = positions
    const metersPerDegLat = 111_320
    const metersPerDegLon = Math.max(111_320 * Math.cos((refLat * Math.PI) / 180), 1)
    this.cellLat = MERGE_EPSILON_METERS / metersPerDegLat
    this.cellLon = MERGE_EPSILON_METERS / metersPerDegLon
  }

  private cellOf(p: LatLon): [number, number] {
    return [Math.round(p.lat / this.cellLat), Math.round(p.lon / this.cellLon)]
  }

  findNear(point: LatLon): NodeId | undefined {
    const [cLat, cLon] = this.cellOf(point)
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        for (const id of this.buckets.get(`${cLat + dLat}:${cLon + dLon}`) ?? []) {
          if (distanceMeters(this.positions[id], point) <= MERGE_EPSILON_METERS) return id
        }
      }
    }
    return undefined
  }

  insert(id: NodeId, point: LatLon) {
    const [cLat, cLon] = this.cellOf(point)
    const key = `${cLat}:${cLon}`
    const bucket = this.buckets.get(key)
    if (bucket) bucket.push(id)
    else this.buckets.set(key, [id])
  }
}

function buildGraph(lines: LatLon[][]): TrailGraph {
  const positions: LatLon[] = []
  const adjacency = new Map<NodeId, Map<NodeId, number>>()
  if (lines.length === 0) return { positions, adjacency }

  const index = new SpatialIndex(positions, lines[0][0].lat)

  function getOrCreateNode(point: LatLon): NodeId {
    const existing = index.findNear(point)
    if (existing !== undefined) return existing
    const id = positions.length
    positions.push(point)
    index.insert(id, point)
    adjacency.set(id, new Map())
    return id
  }

  for (const line of lines) {
    let prevId = getOrCreateNode(line[0])
    for (let i = 1; i < line.length; i++) {
      const id = getOrCreateNode(line[i])
      if (id !== prevId) {
        const weight = distanceMeters(positions[prevId], positions[id])
        adjacency.get(prevId)!.set(id, weight)
        adjacency.get(id)!.set(prevId, weight)
      }
      prevId = id
    }
  }

  return { positions, adjacency }
}

function snapToGraph(graph: TrailGraph, point: LatLon): NodeId | null {
  let best: NodeId | null = null
  let bestDist = SNAP_THRESHOLD_METERS
  for (let id = 0; id < graph.positions.length; id++) {
    const d = distanceMeters(graph.positions[id], point)
    if (d < bestDist) {
      bestDist = d
      best = id
    }
  }
  return best
}

/** Plain Dijkstra — graphs here are local (one padded box around a pair of
 * waypoints), so the simple O(V^2) node scan for the next-closest unvisited
 * node is fast enough without a binary heap. */
function shortestPath(graph: TrailGraph, from: NodeId, to: NodeId): LatLon[] | null {
  if (from === to) return [graph.positions[from]]

  const dist = new Map<NodeId, number>([[from, 0]])
  const prev = new Map<NodeId, NodeId>()
  const visited = new Set<NodeId>()
  const frontier = new Set<NodeId>([from])

  while (frontier.size > 0) {
    let current: NodeId | null = null
    let currentDist = Infinity
    for (const id of frontier) {
      const d = dist.get(id) ?? Infinity
      if (d < currentDist) {
        currentDist = d
        current = id
      }
    }
    if (current === null) break
    frontier.delete(current)
    if (current === to) break
    visited.add(current)

    for (const [neighbor, weight] of graph.adjacency.get(current) ?? []) {
      if (visited.has(neighbor)) continue
      const candidate = currentDist + weight
      if (candidate < (dist.get(neighbor) ?? Infinity)) {
        dist.set(neighbor, candidate)
        prev.set(neighbor, current)
        frontier.add(neighbor)
      }
    }
  }

  if (!dist.has(to)) return null // not reachable within this local graph

  const path: LatLon[] = []
  let cur: NodeId | undefined = to
  while (cur !== undefined) {
    path.unshift(graph.positions[cur])
    if (cur === from) break
    cur = prev.get(cur)
  }
  return path
}

/** Fetches and builds a reusable trail/road graph for an area — the
 * expensive (network) part of tracing. Meant to be built once (e.g. per
 * drawing session) and reused for many cheap, synchronous snapAndTrace
 * calls, rather than re-fetching per segment — that's what makes a live
 * "follow the trail as you move the cursor" preview possible at all,
 * since snapAndTrace alone is fast enough to run on every mouse-move once
 * the network data is already in memory. */
export async function buildTrailGraph(bounds: Bounds, maxTiles?: number): Promise<TrailGraph> {
  const lines = await fetchNetworkGeometry(bounds, maxTiles)
  return buildGraph(lines)
}

/** Synchronous — no network access. Real trail/road path between two
 * points using an already-built graph, if one exists nearby and connects
 * them; falls back to the direct two-point line otherwise (empty graph,
 * neither point close enough to snap, or the two don't connect within
 * this graph's coverage). */
export function snapAndTrace(graph: TrailGraph, from: LatLon, to: LatLon): LatLon[] {
  const fromNode = snapToGraph(graph, from)
  const toNode = snapToGraph(graph, to)
  if (fromNode === null || toNode === null) return [from, to]
  return shortestPath(graph, fromNode, toNode) ?? [from, to]
}

/** Real trail/road path between two points, if one exists nearby and
 * connects them — falls back to the direct two-point line when there's no
 * usable network data, neither point is close enough to snap, or the two
 * don't connect within the locally-fetched area. Fetches fresh graph data
 * scoped just to this pair — see buildTrailGraph/snapAndTrace instead when
 * tracing many pairs against the same general area (e.g. live, per-frame). */
async function traceSegment(from: LatLon, to: LatLon): Promise<LatLon[]> {
  const bounds = boundsAround([from, to], PADDING_DEGREES)
  try {
    const graph = await buildTrailGraph(bounds)
    return snapAndTrace(graph, from, to)
  } catch {
    return [from, to]
  }
}

/**
 * CalTopo-style snap-to-trail: given a rough sequence of waypoints (manual
 * clicks or an AI-agent proposal), traces the real trail/road network
 * between each consecutive pair wherever both ends are close enough to
 * snap onto it, splicing in the actual on-the-ground path instead of a
 * straight line. Segments with no nearby network data — or two points that
 * don't connect within it — fall back to a direct line, so this never
 * fails outright, it just degrades to what was passed in.
 */
export async function traceAlongTrails(waypoints: LatLon[], closed = false): Promise<LatLon[]> {
  if (waypoints.length < 2) return waypoints

  const segmentCount = closed ? waypoints.length : waypoints.length - 1
  const segments = await Promise.all(
    Array.from({ length: segmentCount }, (_, i) => traceSegment(waypoints[i], waypoints[(i + 1) % waypoints.length])),
  )

  const result: LatLon[] = [segments[0][0]]
  for (const segment of segments) result.push(...segment.slice(1))
  return result
}
