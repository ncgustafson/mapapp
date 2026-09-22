import { formatDistance, formatElevation, type ElevationProfilePoint } from '../routes/routeTypes'

// Fixed internal coordinate space — the SVG stretches to whatever width the
// panel gives it via preserveAspectRatio="none", so these are just units,
// not pixels.
const CHART_WIDTH = 300
const CHART_HEIGHT = 90
const PADDING_TOP = 12
const PADDING_BOTTOM = 8

export function ElevationProfileChart({ points, color }: { points: ElevationProfilePoint[]; color: string }) {
  if (points.length < 2) return null

  const elevations = points.map((p) => p.elevationMeters)
  const minElev = Math.min(...elevations)
  const maxElev = Math.max(...elevations)
  const elevRange = Math.max(maxElev - minElev, 1)
  const totalDistance = points[points.length - 1].distanceMeters || 1
  const plotHeight = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM
  const baselineY = PADDING_TOP + plotHeight

  const xFor = (d: number) => (d / totalDistance) * CHART_WIDTH
  const yFor = (elev: number) => baselineY - ((elev - minElev) / elevRange) * plotHeight

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(p.distanceMeters).toFixed(1)},${yFor(p.elevationMeters).toFixed(1)}`)
    .join(' ')
  const areaPath = `${linePath} L${CHART_WIDTH},${baselineY} L0,${baselineY} Z`

  return (
    <div className="elevation-profile">
      <div className="elevation-profile-chart">
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" className="elevation-profile-svg">
          <path d={areaPath} fill={color} fillOpacity={0.18} stroke="none" />
          <path d={linePath} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
        {/* Plain HTML labels, not SVG text — the SVG stretches non-uniformly
            (preserveAspectRatio="none") to fill the panel width, which would
            distort text glyphs drawn inside it. */}
        <span className="elevation-profile-label elevation-profile-label-max">{formatElevation(maxElev)}</span>
        <span className="elevation-profile-label elevation-profile-label-min">{formatElevation(minElev)}</span>
      </div>
      <div className="elevation-profile-distance">
        <span>0 mi</span>
        <span>{formatDistance(totalDistance)}</span>
      </div>
    </div>
  )
}
