// A small non-interactive locator map, in the style NOAA's own forecast
// pages use for their location thumbnail (also ESRI-tiled).
export function staticLocatorMapUrl(
  lat: number,
  lon: number,
  widthPx = 280,
  heightPx = 160,
  spanDeg = 0.35,
): string {
  const halfLon = spanDeg / 2
  const halfLat = (spanDeg * (heightPx / widthPx)) / 2
  const bbox = [lon - halfLon, lat - halfLat, lon + halfLon, lat + halfLat].join(',')

  const params = new URLSearchParams({
    bbox,
    bboxSR: '4326',
    size: `${widthPx},${heightPx}`,
    format: 'png',
    transparent: 'false',
    f: 'image',
  })

  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/export?${params.toString()}`
}
