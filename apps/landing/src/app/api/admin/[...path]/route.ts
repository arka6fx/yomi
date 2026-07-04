import { type NextRequest, NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001"

function authHeader(req: NextRequest) {
  return req.headers.get("authorization") ?? ""
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { error: `Backend returned non-JSON (${res.status})` }
  }
}

function targetUrl(path: string[], search: string) {
  const suffix = path.map(encodeURIComponent).join("/")
  return `${BACKEND}/api/admin/${suffix}${search}`
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const auth = authHeader(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { path } = await ctx.params
  const res = await fetch(targetUrl(path, req.nextUrl.search), {
    headers: { Authorization: auth },
  })
  const data = await safeJson(res)
  return NextResponse.json(data, { status: res.status })
}
