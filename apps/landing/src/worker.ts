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

    const assetRes = await fetch(exeAsset.browser_download_url)
    if (!assetRes.ok) return Response.redirect(GITHUB_RELEASES_FALLBACK, 302)

    const filename = exeAsset.name
    const headers = new Headers(assetRes.headers)
    headers.set("Content-Disposition", `attachment; filename="${filename}"`)
    headers.set("Access-Control-Allow-Origin", "*")

    return new Response(assetRes.body, {
      status: 200,
      statusText: "OK",
      headers,
    })
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
