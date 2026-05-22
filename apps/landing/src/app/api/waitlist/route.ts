export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { email } = body

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return Response.json({ error: "invalid email" }, { status: 400 })
  }

  const backendUrl = process.env.BACKEND_URL
  if (backendUrl) {
    try {
      await fetch(`${backendUrl}/api/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
    } catch {
      // Backend unavailable — don't fail the user
      console.error("[waitlist] backend unreachable")
    }
  }

  return Response.json({ ok: true })
}
