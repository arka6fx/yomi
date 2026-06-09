import { NextResponse } from "next/server"

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

    return NextResponse.redirect(exeAsset.browser_download_url)
  } catch {
    return redirectToReleases()
  }
}

function redirectToReleases() {
  return NextResponse.redirect(
    "https://github.com/arka6fx/yomi-releases/releases/latest",
  )
}
