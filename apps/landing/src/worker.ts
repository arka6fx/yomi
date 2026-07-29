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
  "/pricing": "/#pricing",
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
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self' https://api.getyomi.in https://static.cloudflareinsights.com https://cloudflareinsights.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ")

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set("content-security-policy", CSP)
  // Staged rollout per Lighthouse guidance — raise max-age once this has run
  // in production a while without an accidental HTTPS misconfiguration.
  headers.set("strict-transport-security", "max-age=300")
  return new Response(response.body, { status: response.status, headers })
}

export default {
  async fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> } }) {
    const url = new URL(request.url)

    const redirect = REDIRECTS[url.pathname.replace(/\/$/, "")]
    if (redirect)
      return withSecurityHeaders(Response.redirect(new URL(redirect, url.origin).toString(), 301))

    // IP-based country for localized price display. Served here (not proxied):
    // Cloudflare stamps request.cf.country from the visitor's IP, which is far
    // more reliable than browser language.
    if (url.pathname === "/api/geo") {
      const country = (request as { cf?: { country?: string } }).cf?.country ?? null
      return withSecurityHeaders(
        Response.json({ country }, { headers: { "cache-control": "no-store" } }),
      )
    }

    if (url.pathname.startsWith("/api/")) {
      return proxyToBackend(request, url.pathname + url.search)
    }

    const assetResponse = await env.ASSETS.fetch(request)
    if (assetResponse.status !== 404) {
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

    const fallbackUrl = new URL(request.url)
    fallbackUrl.pathname = "/index.html"
    return withSecurityHeaders(await env.ASSETS.fetch(new Request(fallbackUrl.toString(), request)))
  },
}
