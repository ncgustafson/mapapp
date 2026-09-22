import { useState, type ComponentType, type FormEvent } from 'react'
import { agentAvailable } from '../../routes/routeAgent'
import { useRoutes } from '../../routes/RouteContext'
import { formatDistance, formatElevation, KIND_COLORS, type ElevationProfilePoint, type RouteKind } from '../../routes/routeTypes'
import { ElevationProfileChart } from '../ElevationProfileChart'
import { IconChart, IconEye, IconEyeOff, IconLine, IconPoint, IconPolygon, IconTrash } from '../icons'

const TOOLS: { kind: RouteKind; label: string; hint: string }[] = [
  { kind: 'line', label: 'Line', hint: 'Click to add points along a route.' },
  { kind: 'point', label: 'Point', hint: 'Click once to drop a marker.' },
  { kind: 'polygon', label: 'Polygon', hint: 'Click to add corners of an area.' },
]

const KIND_ICON: Record<RouteKind, ComponentType<{ className?: string }>> = {
  line: IconLine,
  point: IconPoint,
  polygon: IconPolygon,
}

export function RoutePanel() {
  const {
    routes,
    drawMode,
    draftPoints,
    startDrawing,
    finishDrawing,
    cancelDrawing,
    deleteRoute,
    flyToRoute,
    toggleVisibility,
    getElevationProfile,
    agentBusy,
    agentStatus,
    agentError,
    createRouteFromPrompt,
  } = useRoutes()
  const [agentPrompt, setAgentPrompt] = useState('')
  const [expandedRouteId, setExpandedRouteId] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<Record<string, ElevationProfilePoint[] | 'loading'>>({})

  function toggleProfile(id: string) {
    if (expandedRouteId === id) {
      setExpandedRouteId(null)
      return
    }
    setExpandedRouteId(id)
    if (!profiles[id]) {
      setProfiles((prev) => ({ ...prev, [id]: 'loading' }))
      getElevationProfile(id).then((points) => {
        setProfiles((prev) => ({ ...prev, [id]: points }))
      })
    }
  }

  const activeTool = TOOLS.find((t) => t.kind === drawMode)
  const minPoints = drawMode === 'point' ? 1 : drawMode === 'line' ? 2 : 3
  const canFinish = drawMode !== null && drawMode !== 'point' && draftPoints.length >= minPoints

  function handleAgentSubmit(e: FormEvent) {
    e.preventDefault()
    if (!agentPrompt.trim() || agentBusy) return
    createRouteFromPrompt(agentPrompt.trim())
    setAgentPrompt('')
  }

  return (
    <div className="panel">
      <h2>Routes</h2>

      {agentAvailable() && (
        <>
          <h3>Ask AI</h3>
          <form onSubmit={handleAgentSubmit} className="search-form">
            <input
              value={agentPrompt}
              onChange={(e) => setAgentPrompt(e.target.value)}
              placeholder="e.g. a 3 mile loop near here"
              disabled={agentBusy}
            />
            <button type="submit" disabled={agentBusy || !agentPrompt.trim()}>
              {agentBusy ? 'Working…' : 'Build'}
            </button>
          </form>
          {agentBusy && agentStatus && <p className="draw-count">{agentStatus}</p>}
          {agentError && <p className="error">{agentError}</p>}
        </>
      )}

      <h3>Draw</h3>
      <div className="tool-row">
        {TOOLS.map((tool) => {
          const Icon = KIND_ICON[tool.kind]
          return (
            <button
              key={tool.kind}
              className={`tool-button ${drawMode === tool.kind ? 'active' : ''}`}
              onClick={() => (drawMode === tool.kind ? cancelDrawing() : startDrawing(tool.kind))}
            >
              <Icon className="tool-button-icon" />
              {tool.label}
            </button>
          )
        })}
      </div>

      {activeTool && (
        <div className="draw-status">
          <p>{activeTool.hint}</p>
          {drawMode !== 'point' && (
            <>
              <p className="draw-count">{draftPoints.length} point{draftPoints.length === 1 ? '' : 's'} placed</p>
              <div className="draw-actions">
                <button onClick={finishDrawing} disabled={!canFinish}>
                  Finish (Enter)
                </button>
                <button onClick={cancelDrawing}>Cancel (Esc)</button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="saved-header">
        <h3>Saved</h3>
      </div>
      {routes.length === 0 ? (
        <p className="empty">Nothing drawn yet — pick a tool above and click the map.</p>
      ) : (
        <ul className="result-list">
          {routes.map((route) => {
            const visible = route.visible ?? true
            const Icon = KIND_ICON[route.kind]
            return (
              <li key={route.id} className={`route-item ${visible ? '' : 'route-item-hidden'}`}>
                <button
                  className={`visibility-toggle ${visible ? '' : 'hidden'}`}
                  onClick={() => toggleVisibility(route.id)}
                  aria-label={visible ? `Hide ${route.name}` : `Show ${route.name}`}
                  title={visible ? 'Hide' : 'Show'}
                >
                  {visible ? <IconEye /> : <IconEyeOff />}
                </button>
                <button className="route-item-main" onClick={() => flyToRoute(route.id)}>
                  <span className="route-item-swatch" style={{ color: KIND_COLORS[route.kind] }}>
                    <Icon />
                  </span>
                  <span className="route-item-text">
                    <span className="route-item-name">{route.name}</span>
                    {route.distanceMeters !== undefined && (
                      <span className="route-item-stats">
                        {formatDistance(route.distanceMeters)}
                        {route.elevationGainMeters !== undefined && (
                          <>
                            {' '}
                            · ↑{formatElevation(route.elevationGainMeters)} ↓
                            {formatElevation(route.elevationLossMeters ?? 0)}
                          </>
                        )}
                      </span>
                    )}
                  </span>
                </button>
                {route.kind !== 'point' && (
                  <button
                    className={`profile-toggle ${expandedRouteId === route.id ? 'active' : ''}`}
                    onClick={() => toggleProfile(route.id)}
                    aria-label={`Elevation profile for ${route.name}`}
                    title="Elevation profile"
                  >
                    <IconChart />
                  </button>
                )}
                <button className="delete" onClick={() => deleteRoute(route.id)} aria-label={`Delete ${route.name}`} title="Delete">
                  <IconTrash />
                </button>
                {expandedRouteId === route.id &&
                  (profiles[route.id] === 'loading' || !profiles[route.id] ? (
                    <p className="elevation-profile-loading">Sampling terrain…</p>
                  ) : (
                    <ElevationProfileChart points={profiles[route.id] as ElevationProfilePoint[]} color={KIND_COLORS[route.kind]} />
                  ))}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
