const API = "https://api.github.com/repos/arka6fx/yomi-releases/releases/latest"
const FALLBACK = "https://github.com/arka6fx/yomi-releases/releases/latest"

async function getExeUrl(): Promise<string | null> {
  try {
    const res = await fetch(API, { next: { revalidate: 300 }, headers: { "User-Agent": "yomi-landing" } })
    if (!res.ok) return null
    const release = await res.json()
    const exe = release.assets.find((a: { name: string }) => a.name.endsWith(".exe"))
    return exe?.browser_download_url ?? null
  } catch {
    return null
  }
}

export async function GET() {
  const url = await getExeUrl()
  if (!url) return new Response(null, { status: 302, headers: { Location: FALLBACK } })
  return new Response(null, { status: 302, headers: { Location: url } })
}
