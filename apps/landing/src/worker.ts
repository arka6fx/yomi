const BACKEND_URL = "https://api.yomi.arka6fx.com"
const GITHUB_RELEASES_URL = "https://api.github.com/repos/arka6fx/yomi-releases/releases/latest"
const GITHUB_RELEASES_FALLBACK = "https://github.com/arka6fx/yomi-releases/releases/latest"

async function proxyToBackend(request: Request, targetPath: string) {
  const target = new URL(targetPath, BACKEND_URL)
  const upstreamRequest = new Request(target, request)
  return fetch(upstreamRequest)
}

async function handleDownload() {
  try {
    const res = await fetch(GITHUB_RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
      },
    })

    if (!res.ok) return Response.redirect(GITHUB_RELEASES_FALLBACK, 302)

    const release = (await res.json()) as { assets?: Array<{ name: string; browser_download_url: string }> }
    const exeAsset = release.assets?.find((asset) => asset.name.endsWith(".exe"))
    if (!exeAsset) return Response.redirect(GITHUB_RELEASES_FALLBACK, 302)

    // Follow the short-lived GitHub-to-CDN redirect to get the canonical CDN URL
    // (CloudFront / objects.githubusercontent.com) and redirect straight there,
    // avoiding the yomi-releases repo URL entirely.
    const cdnRes = await fetch(exeAsset.browser_download_url, { redirect: "manual" })
    const cdnUrl = cdnRes.headers.get("location")
    if (!cdnUrl) return Response.redirect(exeAsset.browser_download_url, 302)

    return Response.redirect(cdnUrl, 302)
  } catch {
    return Response.redirect(GITHUB_RELEASES_FALLBACK, 302)
  }
}

export default {
  async fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> } }) {
    const url = new URL(request.url)

    if (url.pathname === "/api/download") {
      return handleDownload()
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
