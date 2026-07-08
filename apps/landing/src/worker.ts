const BACKEND_URL = "https://api.getyomi.in"
const GITHUB_RELEASES_URL = "https://api.github.com/repos/arka6fx/yomi-releases/releases/latest"
const GITHUB_RELEASES_FALLBACK = "https://github.com/arka6fx/yomi-releases/releases/latest"

async function proxyToBackend(request: Request, targetPath: string) {
  const target = new URL(targetPath, BACKEND_URL)
  const upstreamRequest = new Request(target, request)
  return fetch(upstreamRequest)
}

async function getAssetUrl(): Promise<string | null> {
  try {
    const res = await fetch(GITHUB_RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "yomi-landing",
      },
    })
    if (!res.ok) return null
    const release = (await res.json()) as {
      assets?: Array<{ name: string; browser_download_url: string }>
    }
    const exeAsset = release.assets?.find((asset) => asset.name.endsWith(".exe"))
    return exeAsset?.browser_download_url ?? null
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

export default {
  async fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> } }) {
    const url = new URL(request.url)

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
