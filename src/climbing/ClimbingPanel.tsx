import { useMemo, useState } from 'react'
import { useClimbing } from './ClimbingContext'
import { BIRDLAND_TOPO } from './climbingTopo'
import type { ClimbingRoute } from './openbeta'

function typeLabel(route: ClimbingRoute): string {
  if (route.trad) return 'trad'
  if (route.sport) return 'sport'
  if (route.topRope) return 'top-rope'
  return ''
}

export function ClimbingPanel() {
  const { routes, loading, error, selectedClimbId, selectClimb, flyToClimb } = useClimbing()
  const [filter, setFilter] = useState('')

  const groupedByWall = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const filtered = needle
      ? routes.filter((r) => r.name.toLowerCase().includes(needle) || r.wallName.toLowerCase().includes(needle))
      : routes

    const groups = new Map<string, ClimbingRoute[]>()
    for (const route of filtered) {
      const group = groups.get(route.wallName)
      if (group) group.push(route)
      else groups.set(route.wallName, [route])
    }
    for (const group of groups.values()) group.sort((a, b) => a.name.localeCompare(b.name))
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [routes, filter])

  return (
    <div className="panel">
      <h2>Climbing</h2>
      <p className="climbing-intro">
        Pine Creek Canyon, Red Rock — routes from{' '}
        <a href="https://openbeta.io" target="_blank" rel="noreferrer">
          OpenBeta
        </a>
        . Markers mark each route's wall, not a precise per-route spot — climbs on the same wall share one
        coordinate in the source data.
      </p>

      {loading && <p className="empty">Loading routes…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && !error && (
        <>
          <input
            className="climbing-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${routes.length} routes…`}
          />
          <div className="climbing-wall-list">
            {groupedByWall.map(([wallName, wallRoutes]) => (
              <div key={wallName}>
                <h4 className="climb-wall-header">{wallName}</h4>
                <ul className="result-list">
                  {wallRoutes.map((route) => (
                    <li key={route.id} className={`route-item ${selectedClimbId === route.id ? 'route-item-selected' : ''}`}>
                      <button
                        className="route-item-main"
                        onClick={() => {
                          selectClimb(route.id)
                          flyToClimb(route.id)
                        }}
                      >
                        <span className="route-item-text">
                          <span className="route-item-name">
                            {route.name}
                            {route.id === BIRDLAND_TOPO.climbId && <span className="climb-topo-badge">topo</span>}
                          </span>
                          <span className="route-item-stats">
                            {route.grade ?? 'grade unknown'}
                            {typeLabel(route) && ` · ${typeLabel(route)}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
