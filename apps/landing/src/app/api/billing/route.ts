import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"

export const runtime = "nodejs"

const BACKEND = process.env.BACKEND_URL ?? ""

async function sessionToken(req: NextRequest): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers: req.headers })
    return session?.session?.token ?? null
  } catch {
    return null
  }
}

// GET /api/billing — current subscription + usage
export async function GET(req: NextRequest) {
  const token = await sessionToken(req)
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Backend not configured — return free defaults so dashboard still loads in dev
  if (!BACKEND) {
    return NextResponse.json({
      plan: "free",
      status: "active",
      tokensUsedThisPeriod: 0,
      currentPeriodEnd: null,
    })
  }

  try {
    const res = await fetch(`${BACKEND}/api/billing/subscription`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return NextResponse.json(await res.json(), { status: res.status })
  } catch {
    return NextResponse.json({ plan: "free", status: "active", tokensUsedThisPeriod: 0, currentPeriodEnd: null })
  }
}

// POST /api/billing — create Razorpay subscription
export async function POST(req: NextRequest) {
  const token = await sessionToken(req)
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!BACKEND) return NextResponse.json({ error: "Backend not configured" }, { status: 503 })

  const body = await req.json()
  try {
    const res = await fetch(`${BACKEND}/api/billing/create-subscription`, {
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
