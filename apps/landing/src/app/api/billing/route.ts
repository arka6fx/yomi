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

export async function GET(req: NextRequest) {
  const auth = authHeader(req)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const res = await fetch(`${BACKEND}/api/billing/subscription`, {
      headers: { Authorization: auth },
    })
    const data = await safeJson(res)
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({
      role: "user",
      plan: "explore",
      status: "inactive",
      trialEndDate: null,
      currentPeriodEnd: null,
      requestsUsed: 0,
      requestsLimit: 100,
      requestsRemaining: 100,
      resetAt: null,
      features: {
        chat: { used: 0, limit: 100 },
        voice: { used: 0, limit: 20 },
        screenshots: { used: 0, limit: 25 },
        reasoning: { used: 0, limit: 0 },
        desktopAutomation: { used: 0, limit: 0 },
        browserAutomation: { used: 0, limit: 0 },
      },
      dailyChatUsed: 0,
      dailyVoiceUsed: 0,
      dailyImageUsed: 0,
      tokensUsedThisPeriod: 0,
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
    const data = await safeJson(res)
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 })
  }
}
