const BACKEND_URL = "https://api.getyomi.in"
const GITHUB_RELEASES_FALLBACK = "https://github.com/arka6fx/yomi-releases/releases/latest"
// electron-updater's manifest, served off the release CDN. Resolving the installer through
// api.github.com instead meant every download hit GitHub's 60/hr unauthenticated limit —
// shared Worker egress IPs blow through that, so the api returned 403 and users got dumped
// on the releases page rather than the .exe.
const LATEST_MANIFEST_URL = `${GITHUB_RELEASES_FALLBACK}/download/latest.yml`

async function proxyToBackend(request: Request, targetPath: string) {
  const target = new URL(targetPath, BACKEND_URL)
  const upstreamRequest = new Request(target, request)
  return fetch(upstreamRequest)
}

async function getAssetUrl(): Promise<string | null> {
  try {
    const res = await fetch(LATEST_MANIFEST_URL, {
      headers: { "User-Agent": "yomi-landing" },
      cf: { cacheTtl: 300, cacheEverything: true },
    } as RequestInit)
    if (!res.ok) return null
    const manifest = await res.text()
    const installer = manifest.match(/^path:\s*(\S+\.exe)\s*$/m)?.[1]
    if (!installer) return null
    return `${GITHUB_RELEASES_FALLBACK}/download/${installer}`
  } catch {
    return null
  }
}

async function handleDownload() {
  const url = await getAssetUrl()
  if (url) return Response.redirect(url, 302)
  return Response.redirect(GITHUB_RELEASES_FALLBACK, 302)
}

async function handleDownloadUrl() {
  const url = await getAssetUrl()
  return Response.json({ url }, { status: url ? 200 : 404 })
}

// These routes each rendered a page that already existed elsewhere. next.config redirects
// never run here — the worker serves prebuilt assets — so they have to live in the worker.
const REDIRECTS: Record<string, string> = {
  "/features": "/#features",
  "/pricing": "/#pricing",
  "/contact": "/support",
}

export default {
  async fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> } }) {
    const url = new URL(request.url)

    const redirect = REDIRECTS[url.pathname.replace(/\/$/, "")]
    if (redirect) return Response.redirect(new URL(redirect, url.origin).toString(), 301)

    if (url.pathname === "/api/download") {
      return handleDownload()
    }
    if (url.pathname === "/api/download-url") {
      return handleDownloadUrl()
    }
    // IP-based country for localized price display. Served here (not proxied):
    // Cloudflare stamps request.cf.country from the visitor's IP, which is far
    // more reliable than browser language (commonly en-US worldwide).
    if (url.pathname === "/api/geo") {
      const country = (request as { cf?: { country?: string } }).cf?.country ?? null
      return Response.json({ country }, { headers: { "cache-control": "no-store" } })
    }

    if (url.pathname.startsWith("/api/")) {
      return proxyToBackend(request, url.pathname + url.search)
    }

    const assetResponse = await env.ASSETS.fetch(request)
    if (assetResponse.status !== 404) return assetResponse

    const fallbackUrl = new URL(request.url)
    fallbackUrl.pathname = "/index.html"
    return env.ASSETS.fetch(new Request(fallbackUrl.toString(), request))
  },
}
