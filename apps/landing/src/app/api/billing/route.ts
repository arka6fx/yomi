import { type NextRequest, NextResponse } from "next/server"

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001"

function authHeader(req: NextRequest) {
  return req.headers.get("authorization") ?? ""
}

export async function GET(req: NextRequest) {
  const auth = authHeader(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Dev fallback — return free defaults if backend not reachable
  try {
    const res = await fetch(`${BACKEND}/api/billing/subscription`, {
      headers: { Authorization: auth },
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({
      role: "user", plan: "explore", status: "inactive",
      trialEndDate: null, currentPeriodEnd: null,
      dailyChatUsed: 0, dailyVoiceUsed: 0, dailyImageUsed: 0, tokensUsedThisPeriod: 0,
    })
  }
}

export async function POST(req: NextRequest) {
  const auth = authHeader(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  try {
    const res = await fetch(`${BACKEND}/api/billing/create-subscription`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 })
  }
}
