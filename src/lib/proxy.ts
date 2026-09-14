// Base URL of our own caching proxy server (see /server). Not deployed yet —
// when VITE_API_BASE_URL isn't set (e.g. the production build), calls go
// directly to the origin instead, same as before this backend existed.
const PROXY_BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined

export function proxied(url: string): string {
  if (!PROXY_BASE_URL) return url
  return `${PROXY_BASE_URL}/proxy?url=${encodeURIComponent(url)}`
}
