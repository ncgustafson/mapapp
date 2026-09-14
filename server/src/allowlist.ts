// Only these hosts can be requested through the proxy — without this, the
// proxy would be an open relay anyone could use to fetch arbitrary URLs
// through our server (SSRF / abuse risk).
const ALLOWED_HOSTS = new Set([
  'api.weather.gov',
  'graphical.weather.gov',
  'overpass-api.de',
  'server.arcgisonline.com',
])

export function isAllowedUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}
