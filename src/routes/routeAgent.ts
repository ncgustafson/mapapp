import Anthropic from '@anthropic-ai/sdk'
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
import * as Cesium from 'cesium'
import { z } from 'zod'
import { findLandmarks, findPaths, findPointsOfInterest } from './mapContext'
import type { LatLon, RouteKind } from './routeTypes'

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined
// Hard ceiling on the whole request — without this, a run of retries (the
// SDK already retries 429/5xx automatically) could leave a single "Build"
// click hanging with no way to tell it apart from an actual freeze.
const OVERALL_TIMEOUT_MS = 90000
// The Tool Runner's automatic loop has no built-in turn cap — with 5 tools
// now available (up from 2), an ambiguous request ("a route through the
// Wonderland Trail", a ~93mi loop split into ~10 separate segments in the
// data) can otherwise send it wandering across many tool calls until it
// hits the timeout above with nothing to show for it. This fails fast and
// clearly well before that.
const MAX_TURNS = 10

// SECURITY NOTE: this calls the Anthropic API directly from the browser
// with a key embedded in the shipped bundle. Anyone visiting this app's
// public deployment could extract and use that key. Accepted as a known
// trade-off for this project — do not copy this pattern into anything
// handling a key you can't afford to have abused. The proper fix is a
// small server-side proxy that holds the key instead.

const SYSTEM_PROMPT = `You are a route-planning assistant inside a 3D backcountry mapping app, in the spirit of CalTopo. The user describes a route/point/area in plain language; you plan real waypoints for it, grounded in real map data — never invent trail names, road names, peak names, or coordinates.

Use get_map_view first to see where the user is currently looking (center point and visible bounds) — anchor your search there unless the user names a different place.

Default assumption: a real route almost always follows an existing trail or road rather than cutting cross-country. For any "line" request (a route/hike/walk/ride/drive — not a single point or an area polygon), call find_paths for the relevant area *before* drawing anything freehand, even if the user didn't name a specific trail. Prefer stitching together real trail/road segments (possibly a mix of several, or trail-to-connect-to-road) over inventing a path, whenever a reasonable one covers the request. Only fall back to a freehand terrain-following line when no suitable real path exists nearby, or the user explicitly asks to go off-trail/bushwhack/direct.

Also pull in other real context when it's relevant:
- find_landmarks — named peaks, mountain passes, and cities/towns, for orienting a route toward/around/near a real named place.
- find_points_of_interest — campsites, water sources, shelters, viewpoints, trailhead parking, etc. Coverage is real but sparse in true backcountry (small/informal features are often unmapped) — empty results mean no data, not necessarily nothing there.
All tools take a bounds box (west/south/east/north in degrees) — reuse get_map_view's visibleBounds, or widen it if the user's request needs a larger search area.

find_paths returns both trails and roads (each tagged "trail" or "road") — pass its name filter whenever the user names a specific one — e.g. "Wonderland Trail" — instead of fetching everything in the area and filtering yourself, that's both cheaper and more complete. Long trails/roads (multi-day trails, ones that circle a whole mountain, etc.) are naturally split into many separate segments in the data, not one continuous line. If the user just says "a route through/along/on [trail]" without asking for its full length, use a sensibly-sized subset (matching a typical single trip on it — a few segments near the current view, not every segment that trail has anywhere) — only stitch together the full extent if they explicitly ask for the whole thing.

Use sample_elevation on candidate waypoints before finalizing (unless you're just tracing an existing trail/road's own points, which already sit on the real terrain), so the route follows sensible terrain (e.g. a "ridge route" should actually track higher ground; avoid routes that cross clearly implausible terrain like straight through a lake unless asked).

Keep total tool calls low — you have at most a few turns. Batch sample_elevation candidates into one call (it accepts up to 50 points at once) rather than checking points one at a time across many calls, and don't re-query find_paths/find_landmarks/find_points_of_interest more than once or twice each.

Call propose_route exactly once, as your last action, with the final waypoints:
- kind "line" for a route/track/trail (list points start to end, ordered)
- kind "point" for a single marker (exactly one point)
- kind "polygon" for an area/zone (list the corners in order; do not repeat the first point at the end)
Use 5-40 points for a line/polygon — enough to trace the actual shape, not just endpoints. Give it a short, descriptive name.`

const LatLonSchema = z.object({ lat: z.number(), lon: z.number() })
const BoundsSchema = z.object({
  west: z.number(),
  south: z.number(),
  east: z.number(),
  north: z.number(),
})

export type AgentRouteProposal = { name: string; kind: RouteKind; points: LatLon[] }

export function agentAvailable(): boolean {
  return Boolean(API_KEY)
}

/**
 * Asks Claude to plan a route from a natural-language description, grounded
 * in the live map: it can look up the current camera view and sample real
 * terrain elevation before committing to waypoints, rather than guessing
 * coordinates from nothing. Uses the SDK's beta Tool Runner (automatic
 * agentic loop) instead of a hand-rolled one.
 */
export async function planRouteWithAgent(
  viewer: Cesium.Viewer,
  userPrompt: string,
  onProgress?: (status: string) => void,
): Promise<AgentRouteProposal> {
  if (!API_KEY) {
    throw new Error('No VITE_ANTHROPIC_API_KEY configured — see .env')
  }

  // maxRetries covers transient 429/5xx (the SDK backs off and retries
  // automatically) — raised a bit above the default 2 as extra headroom,
  // paired with the overall timeout below as a hard backstop.
  const client = new Anthropic({ apiKey: API_KEY, dangerouslyAllowBrowser: true, maxRetries: 4 })
  let proposal: AgentRouteProposal | null = null

  const getMapView = betaZodTool({
    name: 'get_map_view',
    description: "Get the current 3D map camera's center point and visible bounds (lat/lon).",
    inputSchema: z.object({}),
    run: async () => {
      const center = viewer.camera.positionCartographic
      const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid)
      return JSON.stringify({
        centerLat: Cesium.Math.toDegrees(center.latitude),
        centerLon: Cesium.Math.toDegrees(center.longitude),
        cameraHeightMeters: Math.round(center.height),
        visibleBounds: rectangle
          ? {
              west: Cesium.Math.toDegrees(rectangle.west),
              south: Cesium.Math.toDegrees(rectangle.south),
              east: Cesium.Math.toDegrees(rectangle.east),
              north: Cesium.Math.toDegrees(rectangle.north),
            }
          : null,
      })
    },
  })

  const sampleElevation = betaZodTool({
    name: 'sample_elevation',
    description: 'Get real terrain elevation in meters at up to 50 lat/lon points.',
    inputSchema: z.object({ points: z.array(LatLonSchema).min(1).max(50) }),
    run: async (input) => {
      onProgress?.(`Sampling terrain elevation at ${input.points.length} points…`)
      const cartographics = input.points.map((p) => Cesium.Cartographic.fromDegrees(p.lon, p.lat))
      const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographics)
      return JSON.stringify(sampled.map((c) => Math.round(c.height ?? 0)))
    },
  })

  const findPathsTool = betaZodTool({
    name: 'find_paths',
    description:
      'Find real named trail and road segments (each tagged "trail" or "road", with real geometry) within a bounds box — check this before drawing any route freehand. Pass name to get every segment of one specific trail/road (recommended whenever the user names one) instead of everything in the area.',
    inputSchema: z.object({ bounds: BoundsSchema, name: z.string().optional() }),
    run: async (input) => {
      onProgress?.(input.name ? `Searching for "${input.name}"…` : 'Searching for trails/roads in the area…')
      const paths = await findPaths(input.bounds, input.name)
      return JSON.stringify(paths)
    },
  })

  const findLandmarksTool = betaZodTool({
    name: 'find_landmarks',
    description: 'Find named peaks, mountain passes, and cities/towns within a bounds box.',
    inputSchema: z.object({ bounds: BoundsSchema }),
    run: async (input) => {
      onProgress?.('Looking up nearby landmarks…')
      const landmarks = await findLandmarks(viewer, input.bounds)
      return JSON.stringify(landmarks.map((l) => ({ name: l.name, kind: l.kind, lat: l.lat, lon: l.lon })))
    },
  })

  const findPoisTool = betaZodTool({
    name: 'find_points_of_interest',
    description:
      'Find named outdoor points of interest (campsites, water sources, shelters, viewpoints, trailhead parking, etc.) within a bounds box.',
    inputSchema: z.object({ bounds: BoundsSchema }),
    run: async (input) => {
      onProgress?.('Looking up points of interest…')
      const pois = await findPointsOfInterest(input.bounds)
      return JSON.stringify(pois)
    },
  })

  const proposeRoute = betaZodTool({
    name: 'propose_route',
    description: 'Finalize the planned route/point/area. Call this exactly once, as your last action.',
    inputSchema: z.object({
      name: z.string().describe('A short, descriptive name for the route'),
      kind: z.enum(['line', 'point', 'polygon']),
      points: z.array(LatLonSchema).min(1),
    }),
    run: async (input) => {
      onProgress?.('Finalizing route…')
      proposal = input
      return 'Route proposed.'
    },
  })

  const runPromise = (async () => {
    const runner = client.beta.messages.toolRunner({
      model: 'claude-sonnet-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      tools: [getMapView, sampleElevation, findPathsTool, findLandmarksTool, findPoisTool, proposeRoute],
      messages: [{ role: 'user', content: userPrompt }],
    })

    let step = 0
    for await (const message of runner) {
      step++
      onProgress?.(`Thinking… (step ${step})`)
      if (message.stop_reason === 'pause_turn') {
        runner.pushMessages({ role: 'assistant', content: message.content })
      }
      if (proposal || step >= MAX_TURNS) break
    }
  })()

  let timeoutId: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("Claude isn't responding — wait a moment and try again.")),
      OVERALL_TIMEOUT_MS,
    )
  })

  try {
    await Promise.race([runPromise, timeout])
  } finally {
    clearTimeout(timeoutId!)
  }

  if (!proposal) throw new Error("The agent didn't propose a route — try rephrasing.")
  return proposal
}
