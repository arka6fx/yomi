const BACKEND_URL = "https://api.getyomi.in"

async function proxyToBackend(request: Request, targetPath: string) {
  const target = new URL(targetPath, BACKEND_URL)
  const upstreamRequest = new Request(target, request)
  return fetch(upstreamRequest)
}

// These routes each rendered a page that already existed elsewhere. next.config redirects
// never run here because the worker serves prebuilt assets, so they live here too.
const REDIRECTS: Record<string, string> = {
  "/features": "/#features",
  "/contact": "/support",
  // desktop retired — old install links land on the homepage instead of a soft 200
  "/download": "/",
}

// No per-request nonces here — the worker only ever serves prebuilt static HTML (no
// server to stamp a fresh nonce into each response), so next's inline hydration
// scripts and the JSON-LD/RSC payload scripts need 'unsafe-inline'. Still meaningfully
// narrows the attack surface: no third-party script host, no framing, no plugins.
const CSP = [
  "default-src 'self'",
  // us-assets/us.i.posthog.com: product analytics (only loads when a PostHog key is set)
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://telegram.org https://us-assets.i.posthog.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self' https://api.getyomi.in https://static.cloudflareinsights.com https://cloudflareinsights.com https://us.i.posthog.com https://us-assets.i.posthog.com",
  "frame-ancestors https://web.telegram.org",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ")

type RequestGeo = {
  country?: string
  city?: string
  latitude?: string
  longitude?: string
}

// Country and city come from Cloudflare's IP lookup. Weather is fetched here, not in
// the browser: the CSP stays closed and Open-Meteo only ever sees coordinates rounded
// to ~10 km, never the visitor's IP.
async function geoResponse(request: Request): Promise<Response> {
  const cf = (request as { cf?: RequestGeo }).cf ?? {}
  let weather: { tempC: number; code: number } | null = null
  const lat = Number(cf.latitude)
  const lon = Number(cf.longitude)
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(1)}&longitude=${lon.toFixed(1)}&current=temperature_2m,weather_code`,
        {
          cf: { cacheTtl: 900, cacheEverything: true },
          signal: AbortSignal.timeout(2500),
        } as RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } },
      )
      const data = (await res.json()) as {
        current?: { temperature_2m?: number; weather_code?: number }
      }
      const current = data.current
      if (typeof current?.temperature_2m === "number" && typeof current.weather_code === "number") {
        weather = { tempC: Math.round(current.temperature_2m), code: current.weather_code }
      }
    } catch {
      // weather is decoration; the greeting still renders without it
    }
  }
  return Response.json(
    { country: cf.country ?? null, city: cf.city ?? null, weather },
    { headers: { "cache-control": "no-store" } },
  )
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set("content-security-policy", CSP)
  // Staged rollout per Lighthouse guidance — raise max-age once this has run
  // in production a while without an accidental HTTPS misconfiguration.
  headers.set("strict-transport-security", "max-age=300")
  return new Response(response.body, { status: response.status, headers })
}

// The asset binding answers a path it has no asset for with a 307 to "/" rather than a
// 404, so passing every non-404 straight through soft-redirected every unknown URL to
// the homepage — what Search Console reported as "Page with redirect", and the same
// shape as the og:image bug. It also meant the 404 branch below was unreachable.
//
// Redirects that normalise a *real* asset's URL still have to be honoured, and they are
// not distinguishable by target alone: "/index.html" legitimately normalises to "/",
// exactly like a missing path does. They are distinguishable by whether the requested
// path and the target canonicalise to the same thing — a miss always targets "/" no
// matter what was asked for, so only a real asset's own URL can round-trip.
//
// This has to model every normalisation the binding performs, or a real page 404s: it
// also percent-decodes and collapses duplicate slashes, so "//docs", "/docs//" and
// "/docs%2F" are all live URLs for "/docs" that used to be answered with a 404.
function canonicalizeAssetPath(pathname: string): string {
  let out = pathname
  try {
    out = decodeURIComponent(out)
  } catch {
    // malformed escape — compare the raw form rather than throwing
  }
  out = out.replace(/\/{2,}/g, "/").replace(/\/+$/, "")
  if (out.endsWith("/index.html")) out = out.slice(0, -"/index.html".length)
  else if (out.endsWith(".html")) out = out.slice(0, -".html".length)
  return out === "" ? "/" : out
}

// Only actual redirects. 304 Not Modified is a 3xx but carries no Location, so treating
// the whole 3xx range as redirects turned every conditional request — i.e. every repeat
// visit with warm cache — into a 404 for fonts, icons and the webmanifest. It never showed
// up in a fresh load, so smoke, curl and Lighthouse all passed while real returning
// visitors got broken assets.
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export function isUrlNormalizingRedirect(requested: URL, location: string | null): boolean {
  if (!location) return false
  let target: URL
  try {
    target = new URL(location, requested.origin)
  } catch {
    return false
  }
  if (target.origin !== requested.origin) return false
  return canonicalizeAssetPath(target.pathname) === canonicalizeAssetPath(requested.pathname)
}

export default {
  async fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> } }) {
    const url = new URL(request.url)

    const redirect = REDIRECTS[url.pathname.replace(/\/$/, "")]
    if (redirect)
      return withSecurityHeaders(Response.redirect(new URL(redirect, url.origin).toString(), 301))

    // Referral links carry a code as a URL segment. This worker only ever serves
    // prebuilt static assets (see the REDIRECTS comment above) — the dynamic page at
    // app/r/[code]/page.tsx has no prebuilt asset and 404s in production. This is
    // the production path; the page still exists for `next dev` parity.
    const referralMatch = url.pathname.match(/^\/r\/([A-Za-z0-9_-]{1,64})\/?$/)
    if (referralMatch) {
      const target = new URL(`/signup?ref=${encodeURIComponent(referralMatch[1]!)}`, url.origin)
      return withSecurityHeaders(
        new Response(null, {
          status: 302,
          headers: { location: target.toString(), "x-robots-tag": "noindex" },
        }),
      )
    }

    // IP-based country for localized price display. Served here (not proxied):
    // Cloudflare stamps request.cf.country from the visitor's IP, which is far
    // more reliable than browser language.
    if (url.pathname === "/api/geo") {
      return withSecurityHeaders(await geoResponse(request))
    }

    if (url.pathname.startsWith("/api/")) {
      return proxyToBackend(request, url.pathname + url.search)
    }

    const assetResponse = await env.ASSETS.fetch(request)
    const isRedirect = REDIRECT_STATUSES.has(assetResponse.status)
    const missing =
      assetResponse.status === 404 ||
      (isRedirect && !isUrlNormalizingRedirect(url, assetResponse.headers.get("location")))

    if (!missing) {
      // Cloudflare infers content-type from the file extension. The prerendered og:image
      // ships extensionless (it's served at next's route path, "/opengraph-image"), so it
      // comes back with no content-type — some og:image scrapers require one to render it.
      if (url.pathname === "/opengraph-image" && !assetResponse.headers.get("content-type")) {
        const headers = new Headers(assetResponse.headers)
        headers.set("content-type", "image/png")
        return withSecurityHeaders(
          new Response(assetResponse.body, { status: assetResponse.status, headers }),
        )
      }
      return withSecurityHeaders(assetResponse)
    }

    // Serve next's prerendered 404 page with a real 404. Not a redirect to "/" (a
    // crawler reads that as the homepage moving) and not a 200 (a soft 404). Requested
    // extensionless: "/_not-found.html" would itself normalise to "/_not-found".
    const notFound = await env.ASSETS.fetch(
      new Request(new URL("/_not-found", url.origin).toString(), { headers: request.headers }),
    )
    return withSecurityHeaders(
      new Response(notFound.body, {
        status: 404,
        headers: {
          "content-type": notFound.headers.get("content-type") ?? "text/html; charset=utf-8",
          // never let a 404 stick at the edge — adding the file later must take effect
          // immediately, which is how adding llms.txt failed its own deploy check
          "cache-control": "no-store",
        },
      }),
    )
  },
}
