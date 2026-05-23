import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"

export const runtime = "nodejs"

const BACKEND = process.env.BACKEND_URL ?? ""

// POST /api/device-confirm — proxy the device-code confirm call to the backend.
// Reads the Better Auth session cookie and forwards as Bearer token so the backend
// can link the authenticated session to the pending device code.
export async function POST(req: NextRequest) {
  let token: string | null = null
  try {
    const session = await auth.api.getSession({ headers: req.headers })
    token = session?.session?.token ?? null
  } catch {
    /* no session */
  }
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  if (!BACKEND) return NextResponse.json({ error: "Backend not configured" }, { status: 503 })

  const body = await req.json()
  try {
    const res = await fetch(`${BACKEND}/api/auth/device-code/confirm`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 })
  }
}
