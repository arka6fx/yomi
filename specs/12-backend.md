# Spec 12 — Cloud Backend

## Purpose

Define the Hono route map, Better Auth configuration, LLM proxy design (Vercel AI SDK), usage metering pipeline, and Stripe integration. The backend is the trust boundary — all secrets live here.

## Invariants

- LLM API keys exist ONLY in the backend. Never in the sidecar or desktop bundle.
- Every LLM call from the sidecar is proxied through `/api/llm/stream`. The backend adds the key.
- Usage is metered on EVERY proxied call, before the response is streamed back.
- Stripe webhook endpoints must verify the `stripe-signature` header before processing.

## Detailed Design

### Route Map

```
GET  /health                          → { status, version }

── Auth (Better Auth handles these) ──────────────────────
POST /api/auth/sign-up
POST /api/auth/sign-in
POST /api/auth/sign-out
GET  /api/auth/session
GET  /api/auth/callback/:provider     OAuth callback (deep-link to yomi://)
POST /api/auth/device-code            Device-code flow for desktop

── LLM Proxy ──────────────────────────────────────────────
POST /api/llm/stream                  Proxy to Anthropic / OpenRouter, stream SSE
  Auth: Bearer JWT
  Body: { model, messages, tools?, stream: true }
  Adds: API key, usage logging, rate limiting

── Speech Proxy ────────────────────────────────────────────
POST /api/stt                         Proxy to ElevenLabs STT
  Auth: Bearer JWT
  Body: { audio_b64: string }
  Returns: { transcript: string }

── Usage ──────────────────────────────────────────────────
POST /api/usage                       Record a usage event
  Auth: Bearer JWT
  Body: UsageEvent

── Billing (Stripe) ───────────────────────────────────────
POST /api/billing/create-checkout     Create Stripe Checkout session
POST /api/billing/portal              Create Stripe Customer Portal link
POST /api/billing/webhook             Stripe webhook (unauthed, signature-verified)
GET  /api/billing/subscription        Current subscription + usage this period

── Memory Sync (Phase 3+) ─────────────────────────────────
PUT  /api/memory/:path                Upload/update a memory blob
GET  /api/memory/:path                Download a memory blob
GET  /api/memory                      List all blobs (path + hash + updated_at)
  Note: DB stores metadata only (path, content_hash, size_bytes). Actual content
  lives in object storage (R2 or S3-compatible). Phase 3 adds storage adapter.
```

### Better Auth Configuration

```typescript
// apps/backend/src/auth.ts
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  plugins: [
    organization(),           // Team tier: orgs + members + roles
  ],
  socialProviders: {
    google: { clientId, clientSecret },   // GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
    github: { clientId, clientSecret },   // GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
  },
  advanced: {
    customSession: async (session) => ({
      ...session,
      user: { ...session.user, plan: await getUserPlan(session.user.id) },
    }),
  },
})
```

Device-code flow for the desktop: standard OAuth2 device authorization grant. Better Auth does not have a built-in device-code plugin — implement a thin custom route on top.

### LLM Proxy Design (Vercel AI SDK)

```typescript
// POST /api/llm/stream
app.post("/api/llm/stream", authenticate, rateLimit, async (c) => {
  const { model, messages, tools, maxTokens } = await c.req.json()
  const user = c.get("user")

  // Route to provider
  const provider = resolveProvider(model)   // anthropic | openrouter

  // Meter BEFORE streaming (estimate input tokens)
  const inputTokens = estimateTokens(messages)
  await db.insert(usageEvents).values({
    userId: user.id, kind: "llm_stream",
    model, inputTokens, status: "started",
  })

  // Stream
  const result = streamText({ model: provider(model), messages, tools, maxTokens })

  // Meter on completion (actual output tokens from usage metadata)
  result.usage.then(async (usage) => {
    await db.update(usageEvents)
      .set({ outputTokens: usage.completionTokens, status: "done" })
      .where(...)
  })

  return result.toDataStreamResponse()
})
```

**Provider resolution:**

OpenRouter is accessed via `@ai-sdk/openai` with a custom base URL — not a separate SDK package.
Groq requires adding `@ai-sdk/groq` to `apps/backend/package.json` before enabling.

```typescript
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"

const anthropic = createAnthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] })
// OpenRouter: any model via @ai-sdk/openai + LLM_BASE_URL
const openrouter = createOpenAI({
  baseURL: process.env["LLM_BASE_URL"] ?? "https://openrouter.ai/api/v1",
  apiKey: process.env["OPENROUTER_API_KEY"],
})

function resolveProvider(model: string) {
  if (model.startsWith("claude-")) return anthropic
  if (model.includes("/")) return openrouter   // e.g. "anthropic/claude-haiku-4-5"
  return anthropic  // default
}
```

### Usage Metering Pipeline

1. Every proxied LLM call records a `usage_events` row (append-only).
2. A soft cap check runs on each request: if `daily_tokens > plan.soft_cap` → add a warning header. If `daily_tokens > plan.hard_cap` → 429.
3. Caps are read from a plan config (not stored per-user to allow plan changes without migration).
4. The `GET /api/billing/subscription` endpoint returns live usage this period (sum of `usage_events` since `current_period_start`).

### Stripe Integration

```typescript
// Webhook handler
app.post("/api/billing/webhook", async (c) => {
  const sig = c.req.header("stripe-signature")!
  const event = stripe.webhooks.constructEvent(
    await c.req.text(), sig, STRIPE_WEBHOOK_SECRET
  )

  switch (event.type) {
    case "checkout.session.completed":
      await activateSubscription(event.data.object)
      break
    case "customer.subscription.updated":
      await syncSubscription(event.data.object)
      break
    case "customer.subscription.deleted":
      await downgradeToFree(event.data.object.customer)
      break
    case "invoice.payment_failed":
      await markPaymentFailed(event.data.object.customer)
      break
  }
})
```

## Environment Variables

All secrets live in the backend. These must be set:

```
DATABASE_URL              Neon serverless Postgres URL
BETTER_AUTH_SECRET        Random secret for Better Auth session signing
BETTER_AUTH_URL           https://api.yomi.app (or http://localhost:3001 in dev)
GOOGLE_CLIENT_ID          OAuth — Google
GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID          OAuth — GitHub
GITHUB_CLIENT_SECRET
ANTHROPIC_API_KEY         Primary LLM key
OPENROUTER_API_KEY        Optional — OpenRouter fallback
LLM_BASE_URL              https://openrouter.ai/api/v1 (set together with OPENROUTER_API_KEY)
ELEVENLABS_API_KEY        STT + TTS proxy
STRIPE_SECRET_KEY         Stripe server-side key
STRIPE_WEBHOOK_SECRET     Stripe webhook signing secret
ENCRYPTION_KEY            32-byte hex key for AES-256-GCM (encrypt OAuth tokens in DB)
SIDECAR_SECRET            Shared secret for desktop ↔ backend calls
```

`@yomi/db` exports `db` (Drizzle client), `encryptTokens`, `decryptTokens` — import from there.

## Files to change

- `apps/backend/src/index.ts` — Hono app entry point, route registration

## Files to create

- `apps/backend/src/auth.ts` — Better Auth configuration + `authenticate` middleware
- `apps/backend/src/providers.ts` — LLM provider resolution (anthropic / openrouter via @ai-sdk/openai)
- `apps/backend/src/routes/llm.ts` — POST /api/llm/stream proxy
- `apps/backend/src/routes/stt.ts` — POST /api/stt proxy
- `apps/backend/src/routes/usage.ts` — POST /api/usage
- `apps/backend/src/routes/billing.ts` — Stripe checkout, portal, webhook, helpers
- `apps/backend/src/routes/auth-routes.ts` — Device-code flow for desktop
- `apps/backend/src/routes/memory.ts` — Memory sync (Phase 3+, stub only for now)
- `apps/backend/src/middleware/rate-limit.ts` — Per-user in-memory token bucket

## Open Questions

- Rate limiting: per-user token bucket in memory (Phase 3) vs Redis (Phase 4+). Start in-memory.
- STT proxy: proxy ElevenLabs STT through the backend (same key management pattern as LLM) OR allow the sidecar to call ElevenLabs directly with a restricted key. Lean toward proxy for uniform key management.
- Groq support: `@ai-sdk/groq` not yet in `package.json`. Add only if Groq models are needed.
