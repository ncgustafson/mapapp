import type { TopoLine } from './climbingTopo'

/**
 * A real photo of the wall with a route line drawn over it — the standard
 * way every climbing app/guidebook shows "the route on the wall" (vertical
 * rock has no GPS line data to draw on a 3D map — see climbingTopo.ts).
 * Points are normalized (0-1) image coordinates; the SVG overlay uses a
 * matching 0-1 viewBox so it tracks the <img> at any render size.
 */
export function ClimbingTopoView({ topo, routeName, onClose }: { topo: TopoLine; routeName: string; onClose: () => void }) {
  const path = topo.points.map(([x, y]) => `${x},${y}`).join(' L ')

  return (
    <div className="topo-backdrop" onClick={onClose}>
      <div className="topo-card" onClick={(e) => e.stopPropagation()}>
        <div className="topo-header">
          <span>{routeName} — approximate line</span>
          <button className="topo-close" onClick={onClose} aria-label="Close topo">
            ×
          </button>
        </div>
        <div className="topo-image-wrap">
          <img src={topo.image} alt={`${routeName} topo`} />
          <svg className="topo-overlay" viewBox="0 0 1 1" preserveAspectRatio="none">
            <path
              d={`M ${path}`}
              fill="none"
              stroke="#fde047"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="7 6"
              vectorEffect="non-scaling-stroke"
            />
            {topo.points.map(([x, y], i) => (
              // r is in the 0-1 viewBox space (unlike the stroke above, a
              // fill shape's radius isn't exempted by non-scaling-stroke),
              // so this is a fraction of image width, not a pixel size.
              <circle key={i} cx={x} cy={y} r={0.01} fill="#fde047" />
            ))}
          </svg>
        </div>
        <p className="topo-note">{topo.note}</p>
        <p className="topo-credit">{topo.imageCredit}</p>
      </div>
    </div>
  )
}
