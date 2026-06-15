export async function GET() {
  try {
    const res = await fetch(
      "https://api.github.com/repos/arka6fx/yomi-releases/releases/latest",
      { next: { revalidate: 300 } },
    )
    if (!res.ok) return redirectToReleases()

    const release = await res.json()
    const exeAsset = release.assets.find(
      (a: { name: string }) => a.name.endsWith(".exe"),
    )
    if (!exeAsset) return redirectToReleases()

    const assetRes = await fetch(exeAsset.browser_download_url)
    if (!assetRes.ok) return redirectToReleases()

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
    return redirectToReleases()
  }
}

function redirectToReleases() {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "https://github.com/arka6fx/yomi-releases/releases/latest",
    },
  })
}
