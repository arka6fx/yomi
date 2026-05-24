# Spec 12 — Backend

## Purpose

Define the Hono backend at `apps/backend` — REST routes, authentication via Better Auth, LLM proxy with metering, and Razorpay billing integration.

## Invariants

- Hono is the sole backend framework.
- All LLM keys live ONLY in the backend environment — never shipped to desktop or sidecar.
- `SIDECAR_SECRET` is shared between backend and sidecar for cross-service auth.
- Billing is powered by Razorpay (not Stripe).

## Detailed Design

### Routes

#### `POST /api/v1/billing/create-subscription`

Body: `{ plan_id: string, customer_id: string }`
- Creates a Razorpay subscription via `razorpay.subscriptions.create()`.
- Updates user record with `razorpay_sub_id`.
- Returns `{ subscription_id, short_url }`.

#### `POST /api/v1/billing/webhook`

- Verifies Razorpay webhook signature using `createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)`.
- Handles `subscription.activated`, `subscription.completed`, `subscription.cancelled`, `payment.failed`.
- Updates user plan and subscription status accordingly.

#### `POST /api/v1/llm/chat`

- Proxies LLM client calls from sidecar through the backend.
- Checks user plan caps: `basic: 500 requests/day, standard: 2000, genesis: 10000`.
- Injects the AI Credits key from `OPENAI_API_KEY` into the LLM request.
- Returns response as text/event-stream.

#### `POST /api/v1/stt/transcribe`

- Proxies Sarvam STT requests from sidecar when speech is routed through the backend.
- Checks user plan caps.
- Injects `SARVAM_API_KEY` from backend env.
- Returns transcript text.

### Rate limiting

Limit | Basic | Standard | Genesis | Free
---|---|---|---|---
LLM requests/day | 500 | 2000 | 10000 | 10
STT minutes/day | 30 | 120 | 600 | 2

### Pricing plans

Plan | Price (USD/month) | LLM calls/day | STT minutes/day
---|---|---|---
Free | $0 | 10 | 2
Basic | $4 | 500 | 30
Standard | $9 | 2000 | 120
Genesis | $19 | 10000 | 600

### Wiring

```typescript
const app = new Hono()
app.use("/api/*", cors())
app.on(["POST", "GET"], "/api/auth/*", authHandler)
app.post("/api/v1/billing/create-subscription", billingHandler)
app.post("/api/v1/billing/webhook", billingWebhookHandler)
app.post("/api/v1/llm/chat", llmProxyHandler)
app.post("/api/v1/stt/transcribe", sttProxyHandler)
```

### Middleware

- Rate limiter (per `plan` column on `users`, enforced via per-user token bucket in Postgres or in-memory with Neon advisory locks).
- Auth checker (validates session cookie via Better Auth, attaches user to `c.req` context).
- Metering counter (increments usage counter on every LLM/STT request, checked before proceeding).

## Files to change

- `apps/backend/src/index.ts` — register new routes.
- `apps/backend/src/middleware/rate-limit.ts` — per-plan rate limiter.
- `apps/backend/package.json` — add `razorpay` and OpenAI-compatible provider dependencies; remove `stripe`.

## Files to create

- `apps/backend/src/routes/billing.ts` — Razorpay subscription creation + webhook handler.
- `apps/backend/src/routes/llm.ts` — LLM proxy with plan cap checks.
- `apps/backend/src/routes/stt.ts` — STT proxy with plan cap checks.
- `apps/backend/src/providers.ts` — OpenAI provider factory.

## Open Questions

- Razorpay webhook secret: stored as `RAZORPAY_WEBHOOK_SECRET` env var.
- Rate limit persistence: in-memory per-instance with Neon advisory locks for multi-instance sync.
