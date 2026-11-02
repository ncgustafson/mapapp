import OpenAI from 'openai'
import * as Cesium from 'cesium'
import { z } from 'zod'
import { findLandmarks, findPaths, findPointsOfInterest } from './mapContext'
import type { LatLon, RouteKind } from './routeTypes'

// Runs fully local via Ollama (https://ollama.com) — no API key, no rate
// limit, nothing leaves the machine. Hosted open-weight providers (Groq,
// OpenRouter, etc.) were tried first, but even their free tiers cap token
// throughput too low for this agent's multi-turn tool-calling loop
// (confirmed: every model on a free Groq account shared one flat 8,000
// tokens/min cap, which a single route-planning turn can exceed on its
// own). `ollama pull llama3.1:8b` once, then `ollama serve` (or `brew
// services start ollama`) before using "Ask AI".
const BASE_URL = (import.meta.env.VITE_OLLAMA_BASE_URL as string | undefined) || 'http://localhost:11434/v1'
const MODEL = (import.meta.env.VITE_OLLAMA_MODEL as string | undefined) || 'llama3.1:8b'
// Hard ceiling on the whole request — without this, a run of retries (the
// SDK already retries 5xx automatically) could leave a single "Build" click
// hanging with no way to tell it apart from an actual freeze. Local
// inference is slower than a hosted API (especially without a GPU, and
// across up to MAX_TURNS model calls), so this is generous compared to what
// a hosted-API version of this agent used.
const OVERALL_TIMEOUT_MS = 180000
// The hand-rolled loop below has no built-in turn cap otherwise — with 5
// tools available, an ambiguous request ("a route through the Wonderland
// Trail", a ~93mi loop split into ~10 separate segments in the data) can
// otherwise send it wandering across many tool calls until it hits the
// timeout above with nothing to show for it. This fails fast and clearly
// well before that.
const MAX_TURNS = 10

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
  // Paused: no AI provider is currently set up (Groq's free tier was too
  // rate-limited for this agent's multi-turn tool loop; local Ollama was
  // too heavy on this machine's CPU). Hidden rather than left visibly
  // broken until a provider is picked back up — see planRouteWithAgent
  // below, which still has the Ollama wiring if that's revisited.
  return false
}

type ToolDef<Input> = {
  name: string
  description: string
  parameters: Record<string, unknown>
  schema: z.ZodType<Input>
  run: (input: Input) => Promise<string>
}

// One zod schema doubles as both runtime validation and (via zod 4's
// built-in JSON Schema conversion) the tool spec Ollama's OpenAI-compatible
// function-calling API expects.
function defineTool<Input>(opts: {
  name: string
  description: string
  inputSchema: z.ZodType<Input>
  run: (input: Input) => Promise<string>
}): ToolDef<Input> {
  const { $schema: _drop, ...parameters } = z.toJSONSchema(opts.inputSchema) as Record<string, unknown>
  return { name: opts.name, description: opts.description, parameters, schema: opts.inputSchema, run: opts.run }
}

async function callTool(tool: ToolDef<unknown>, rawArgs: string | undefined): Promise<string> {
  let json: unknown
  try {
    json = rawArgs ? JSON.parse(rawArgs) : {}
  } catch {
    return 'Invalid JSON arguments — re-check the tool call syntax.'
  }
  const parsed = tool.schema.safeParse(json)
  if (!parsed.success) {
    return `Invalid arguments: ${parsed.error.message}`
  }
  try {
    return await tool.run(parsed.data)
  } catch (err) {
    return `Tool error: ${err instanceof Error ? err.message : String(err)}`
  }
}

/**
 * Asks a local open-weight model (via Ollama) to plan a route from a
 * natural-language description, grounded in the live map: it can look up
 * the current camera view and sample real terrain elevation before
 * committing to waypoints, rather than guessing coordinates from nothing.
 * Hand-rolls the tool-calling loop against Ollama's OpenAI-compatible chat
 * completions API (unlike Anthropic, it has no built-in agentic runner).
 */
export async function planRouteWithAgent(
  viewer: Cesium.Viewer,
  userPrompt: string,
  onProgress?: (status: string) => void,
): Promise<AgentRouteProposal> {
  // apiKey is required by the SDK's constructor but ignored by Ollama —
  // any non-empty string works, there's no real credential here.
  const client = new OpenAI({ baseURL: BASE_URL, apiKey: 'ollama', dangerouslyAllowBrowser: true, maxRetries: 4 })
  let proposal: AgentRouteProposal | null = null

  const getMapView = defineTool({
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

  const sampleElevation = defineTool({
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

  const findPathsTool = defineTool({
    name: 'find_paths',
    description:
      'Find real named trail and road segments (each tagged "trail" or "road", with real geometry) within a bounds box — check this before drawing any route freehand. Pass name to get every segment of one specific trail/road (recommended whenever the user names one) instead of everything in the area.',
    // nullish, not just optional — some local models emit an explicit
    // `null` for an omitted optional argument rather than leaving it out,
    // which a plain `.optional()` schema rejects.
    inputSchema: z.object({ bounds: BoundsSchema, name: z.string().nullish() }),
    run: async (input) => {
      onProgress?.(input.name ? `Searching for "${input.name}"…` : 'Searching for trails/roads in the area…')
      const paths = await findPaths(input.bounds, input.name ?? undefined)
      return JSON.stringify(paths)
    },
  })

  const findLandmarksTool = defineTool({
    name: 'find_landmarks',
    description: 'Find named peaks, mountain passes, and cities/towns within a bounds box.',
    inputSchema: z.object({ bounds: BoundsSchema }),
    run: async (input) => {
      onProgress?.('Looking up nearby landmarks…')
      const landmarks = await findLandmarks(viewer, input.bounds)
      return JSON.stringify(landmarks.map((l) => ({ name: l.name, kind: l.kind, lat: l.lat, lon: l.lon })))
    },
  })

  const findPoisTool = defineTool({
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

  const proposeRoute = defineTool({
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

  const tools = [getMapView, sampleElevation, findPathsTool, findLandmarksTool, findPoisTool, proposeRoute]
  const toolsByName = new Map(tools.map((t) => [t.name, t as ToolDef<unknown>]))
  const toolSpecs: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]

  const runPromise = (async () => {
    for (let step = 1; step <= MAX_TURNS && !proposal; step++) {
      onProgress?.(`Thinking… (step ${step})`)
      let completion: OpenAI.Chat.Completions.ChatCompletion
      try {
        completion = await client.chat.completions.create({
          model: MODEL,
          max_tokens: 4096,
          messages,
          tools: toolSpecs,
          tool_choice: 'auto',
        })
      } catch (err) {
        if (err instanceof OpenAI.APIConnectionError) {
          throw new Error(
            `Can't reach Ollama at ${BASE_URL} — make sure it's running (\`ollama serve\`) and that "${MODEL}" is pulled (\`ollama pull ${MODEL}\`).`,
          )
        }
        throw err
      }
      const message = completion.choices[0]?.message
      if (!message) break
      messages.push(message)

      if (!message.tool_calls || message.tool_calls.length === 0) break

      for (const call of message.tool_calls) {
        // All tools declared above are `type: "function"` — the custom-tool
        // branch of this union never applies here, just narrowing for TS.
        if (call.type !== 'function') continue
        const tool = toolsByName.get(call.function.name)
        const resultText = tool
          ? await callTool(tool, call.function.arguments)
          : `Unknown tool: ${call.function.name}`
        messages.push({ role: 'tool', tool_call_id: call.id, content: resultText })
      }
    }
  })()

  let timeoutId: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("The route-planning agent isn't responding — wait a moment and try again.")),
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
