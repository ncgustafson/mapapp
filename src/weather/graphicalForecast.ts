// Mirrors NOAA's own Graphical Forecasts picker (graphical.weather.gov) —
// pulled directly from that site's own config so the values are correct.

import { proxied } from '../lib/proxy'

export type GraphicalElement = {
  code: string
  label: string
  maxPeriod: number
  /** Hours represented by one period step, for labeling the time slider. */
  stepHours: number
}

export const GRAPHICAL_ELEMENTS: GraphicalElement[] = [
  { code: 'MaxT', label: 'High Temperature', maxPeriod: 7, stepHours: 24 },
  { code: 'MinT', label: 'Low Temperature', maxPeriod: 7, stepHours: 24 },
  { code: 'PoP12', label: 'Probability of Precip.', maxPeriod: 13, stepHours: 12 },
  { code: 'ppi', label: 'Precip. Potential Index', maxPeriod: 21, stepHours: 3 },
  { code: 'Wx', label: 'Weather', maxPeriod: 52, stepHours: 3 },
  { code: 'WWA', label: 'Hazards', maxPeriod: 38, stepHours: 3 },
  { code: 'T', label: 'Temperature', maxPeriod: 52, stepHours: 3 },
  { code: 'Td', label: 'Dewpoint', maxPeriod: 52, stepHours: 3 },
  { code: 'WindSpd', label: 'Wind Speed', maxPeriod: 52, stepHours: 3 },
  { code: 'WindGust', label: 'Wind Gust', maxPeriod: 52, stepHours: 3 },
  { code: 'Sky', label: 'Sky Cover', maxPeriod: 52, stepHours: 3 },
  { code: 'QPF', label: 'Amount of Precip.', maxPeriod: 12, stepHours: 6 },
  { code: 'SnowAmt', label: 'Snow Amount', maxPeriod: 12, stepHours: 6 },
  { code: 'IceAccum', label: 'Ice Accumulation', maxPeriod: 12, stepHours: 6 },
  { code: 'ApparentT', label: 'Apparent Temperature', maxPeriod: 52, stepHours: 3 },
  { code: 'RH', label: 'Relative Humidity', maxPeriod: 52, stepHours: 3 },
  { code: 'WaveHeight', label: 'Wave Height', maxPeriod: 45, stepHours: 3 },
]

/**
 * Approximate date/time label for a forecast period, for the slider — NOAA's
 * own period-to-time mapping also accounts for time-of-day and issuance
 * cycle, which isn't replicated here; this is a reasonable approximation.
 */
export function periodDateLabel(element: GraphicalElement, period: number): string {
  const date = new Date(Date.now() + period * element.stepHours * 60 * 60 * 1000)
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
  })
}

export type GraphicalSector = { code: string; label: string }

export const GRAPHICAL_REGIONS: GraphicalSector[] = [
  { code: 'conus', label: 'CONUS Area' },
  { code: 'pacnorthwest', label: 'Pacific Northwest' },
  { code: 'pacsouthwest', label: 'Pacific Southwest' },
  { code: 'northrockies', label: 'Northern Rockies' },
  { code: 'centrockies', label: 'Central Rockies' },
  { code: 'southrockies', label: 'Southern Rockies' },
]

export const GRAPHICAL_STATES: GraphicalSector[] = [
  { code: 'alabama', label: 'Alabama' },
  { code: 'aktrimmed', label: 'Alaska' },
  { code: 'arizona', label: 'Arizona' },
  { code: 'arkansas', label: 'Arkansas' },
  { code: 'northcalifornia', label: 'Northern California' },
  { code: 'southcalifornia', label: 'Southern California' },
  { code: 'colorado', label: 'Colorado' },
  { code: 'connecticut', label: 'Connecticut' },
  { code: 'delaware', label: 'Delaware' },
  { code: 'florida', label: 'Florida' },
  { code: 'georgia', label: 'Georgia' },
  { code: 'hawaii', label: 'Hawaii' },
  { code: 'idaho', label: 'Idaho' },
  { code: 'illinois', label: 'Illinois' },
  { code: 'indiana', label: 'Indiana' },
  { code: 'iowa', label: 'Iowa' },
  { code: 'kansas', label: 'Kansas' },
  { code: 'kentucky', label: 'Kentucky' },
  { code: 'louisiana', label: 'Louisiana' },
  { code: 'maine', label: 'Maine' },
  { code: 'maryland', label: 'Maryland' },
  { code: 'massachusetts', label: 'Massachusetts' },
  { code: 'michigan', label: 'Michigan' },
  { code: 'minnesota', label: 'Minnesota' },
  { code: 'mississippi', label: 'Mississippi' },
  { code: 'missouri', label: 'Missouri' },
  { code: 'montana', label: 'Montana' },
  { code: 'nebraska', label: 'Nebraska' },
  { code: 'nevada', label: 'Nevada' },
  { code: 'newhampshire', label: 'New Hampshire' },
  { code: 'newjersey', label: 'New Jersey' },
  { code: 'newmexico', label: 'New Mexico' },
  { code: 'newyork', label: 'New York' },
  { code: 'northcarolina', label: 'North Carolina' },
  { code: 'northdakota', label: 'North Dakota' },
  { code: 'ohio', label: 'Ohio' },
  { code: 'oklahoma', label: 'Oklahoma' },
  { code: 'oregon', label: 'Oregon' },
  { code: 'pennsylvania', label: 'Pennsylvania' },
  { code: 'rhodeisland', label: 'Rhode Island' },
  { code: 'southcarolina', label: 'South Carolina' },
  { code: 'southdakota', label: 'South Dakota' },
  { code: 'tennessee', label: 'Tennessee' },
  { code: 'easttexas', label: 'Eastern Texas' },
  { code: 'westtexas', label: 'Western Texas' },
  { code: 'utah', label: 'Utah' },
  { code: 'vermont', label: 'Vermont' },
  { code: 'virginia', label: 'Virginia' },
  { code: 'washington', label: 'Washington' },
  { code: 'westvirginia', label: 'West Virginia' },
  { code: 'wisconsin', label: 'Wisconsin' },
  { code: 'wyoming', label: 'Wyoming' },
]

export function graphicalImageUrl(sector: string, elementCode: string, period: number): string {
  const params = new URLSearchParams({
    width: '515',
    sector,
    element: elementCode.toLowerCase(),
    n: String(period),
  })
  return proxied(`https://graphical.weather.gov/GraphicalNDFD.php?${params.toString()}`)
}

// Approximate [west, south, east, north] bounding boxes in degrees, used both
// to fly the map to a sector and (for states) to reverse-lookup which sector
// the map is currently over. Approximate rectangles, not true state borders —
// good enough for framing a view and for a sensible auto-selection.
export const GRAPHICAL_SECTOR_BOUNDS: Record<string, [number, number, number, number]> = {
  conus: [-125, 24, -66, 49.5],
  pacnorthwest: [-125, 42, -116, 49.5],
  pacsouthwest: [-125, 32, -114, 42],
  northrockies: [-116, 42, -104, 49],
  centrockies: [-112, 36, -102, 42],
  southrockies: [-112, 31, -103, 37],

  alabama: [-88.5, 30.2, -84.9, 35.0],
  aktrimmed: [-168, 54, -130, 71],
  arizona: [-114.8, 31.3, -109.0, 37.0],
  arkansas: [-94.6, 33.0, -89.6, 36.5],
  northcalifornia: [-124.4, 37.0, -119.0, 42.0],
  southcalifornia: [-121.0, 32.5, -114.1, 37.0],
  colorado: [-109.1, 36.99, -102.0, 41.0],
  connecticut: [-73.7, 40.95, -71.8, 42.05],
  delaware: [-75.8, 38.45, -75.0, 39.84],
  florida: [-87.6, 24.4, -80.0, 31.0],
  georgia: [-85.6, 30.3, -80.8, 35.0],
  hawaii: [-160.3, 18.9, -154.8, 22.3],
  idaho: [-117.3, 42.0, -111.0, 49.0],
  illinois: [-91.5, 36.97, -87.0, 42.5],
  indiana: [-88.1, 37.77, -84.8, 41.76],
  iowa: [-96.64, 40.37, -90.14, 43.5],
  kansas: [-102.05, 37.0, -94.6, 40.0],
  kentucky: [-89.6, 36.5, -81.96, 39.15],
  louisiana: [-94.05, 28.9, -88.8, 33.0],
  maine: [-71.1, 43.06, -66.9, 47.46],
  maryland: [-79.5, 37.9, -75.0, 39.72],
  massachusetts: [-73.5, 41.2, -69.9, 42.9],
  michigan: [-90.4, 41.7, -82.4, 48.3],
  minnesota: [-97.24, 43.5, -89.5, 49.38],
  mississippi: [-91.65, 30.2, -88.1, 35.0],
  missouri: [-95.77, 36.0, -89.1, 40.6],
  montana: [-116.05, 44.36, -104.0, 49.0],
  nebraska: [-104.05, 40.0, -95.3, 43.0],
  nevada: [-120.0, 35.0, -114.04, 42.0],
  newhampshire: [-72.56, 42.7, -70.6, 45.3],
  newjersey: [-75.56, 38.93, -73.9, 41.36],
  newmexico: [-109.05, 31.33, -103.0, 37.0],
  newyork: [-79.76, 40.5, -71.85, 45.02],
  northcarolina: [-84.32, 33.84, -75.46, 36.59],
  northdakota: [-104.05, 45.94, -96.55, 49.0],
  ohio: [-84.82, 38.4, -80.52, 42.32],
  oklahoma: [-103.0, 33.6, -94.43, 37.0],
  oregon: [-124.57, 42.0, -116.46, 46.29],
  pennsylvania: [-80.52, 39.72, -74.69, 42.27],
  rhodeisland: [-71.86, 41.15, -71.12, 42.02],
  southcarolina: [-83.35, 32.0, -78.5, 35.22],
  southdakota: [-104.06, 42.48, -96.44, 45.94],
  tennessee: [-90.31, 34.98, -81.65, 36.68],
  easttexas: [-100.0, 25.8, -93.5, 36.5],
  westtexas: [-106.65, 25.8, -100.0, 36.5],
  utah: [-114.05, 37.0, -109.04, 42.0],
  vermont: [-73.44, 42.73, -71.5, 45.02],
  virginia: [-83.68, 36.54, -75.24, 39.47],
  washington: [-124.85, 45.54, -116.92, 49.05],
  westvirginia: [-82.65, 37.2, -77.72, 40.64],
  wisconsin: [-92.89, 42.49, -86.8, 47.08],
  wyoming: [-111.06, 40.99, -104.05, 45.0],
}

/**
 * Finds which state's bounding box contains a point, for keeping the region
 * selection in sync as the map is panned. Only checks states (not the
 * broader multi-state regions) since those overlap too much to pick one
 * unambiguously.
 */
export function findStateSectorForPoint(lat: number, lon: number): string | null {
  for (const state of GRAPHICAL_STATES) {
    const bounds = GRAPHICAL_SECTOR_BOUNDS[state.code]
    if (!bounds) continue
    const [west, south, east, north] = bounds
    if (lon >= west && lon <= east && lat >= south && lat <= north) {
      return state.code
    }
  }
  return null
}
