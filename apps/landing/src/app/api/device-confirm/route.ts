import { type NextRequest, NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001"

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const body = await req.json()
  try {
    const res = await fetch(`${BACKEND}/api/auth/device-code/confirm`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 })
  }
}
