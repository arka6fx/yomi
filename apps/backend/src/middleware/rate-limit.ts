import type { Context, Next } from "hono"

// Per-user in-memory token bucket (Phase 4+: replace with Redis)
const buckets = new Map<string, { tokens: number; lastRefill: number }>()

// Requests per minute by plan
const LIMITS: Record<string, number> = {
  explore: 10,
  pro:     30,
  max:     120,
}

export async function rateLimit(c: Context, next: Next) {
  const user = c.get("user")
  // Owners have no rate limit
  if (user.role === "owner") return next()

  const limit = LIMITS[user.plan] ?? 10
  const now = Date.now()
  const key = user.id

  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { tokens: limit, lastRefill: now }
    buckets.set(key, bucket)
  }

  const elapsed = (now - bucket.lastRefill) / 60_000
  if (elapsed >= 1) {
    bucket.tokens = limit
    bucket.lastRefill = now
  }

  if (bucket.tokens <= 0) {
    return c.json({ error: "Rate limit exceeded" }, 429)
  }
  bucket.tokens--
  await next()
}
