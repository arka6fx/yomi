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

    // Follow the GitHub-to-CDN redirect to get the canonical CDN URL
    const cdnRes = await fetch(exeAsset.browser_download_url, { redirect: "manual" })
    const cdnUrl = cdnRes.headers.get("location")
    if (!cdnUrl) return redirectToReleases()

    return new Response(null, {
      status: 302,
      headers: { Location: cdnUrl },
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
