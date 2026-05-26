# Spec 12 - Backend

## Purpose

Define the Hono backend: Better Auth, billing, usage metering, LLM/STT proxying, and Cloud RAG APIs.

## Invariants

- Hono is the backend framework.
- LLM and speech provider keys live only in backend/server environments.
- Razorpay is the payment processor.
- Usage and feature gates are enforced at backend API boundaries.
- Cloud RAG stores explicit uploads only; it never reads desktop files directly.

## Route Groups

```ts
app.route("/api/billing", billingRoutes)
app.route("/api/usage", usageRoutes)
app.route("/api/llm", llmRoutes)
app.route("/api/rag", ragRoutes)
app.post("/api/stt", sttHandler)
app.on(["GET", "POST"], "/api/auth/*", auth.handler)
```

## Auth

Better Auth validates session cookies and bearer tokens. Desktop uses the device-code flow and then sends:

```http
Authorization: Bearer <session-token>
```

Authenticated route handlers resolve the current user before applying plan gates.

## Billing

Billing routes create Razorpay subscriptions and receive webhooks. Webhooks update the user's `plan`, `subscription_status`, and subscription records.

Current self-serve launch plans:

- `explore`
- `pro`
- `max` (normal purchase/access blocked until launch; owner/dev override can still test)

## Usage Metering

`usage_events` is append-only. Daily counters are enforced by usage kind:

| Kind | Explore | Pro | Max |
|---|---:|---:|---:|
| `fast_query` / chat | 150 trial total | 10000/day | 10000/day |
| `stt` / voice | included in trial cap | 200/day | 10000/day |
| `agent_run` | 0 | 0 | 10000/day |

Explore is a 30-day/150-interaction trial. Agent mode remains Max-only.

## LLM Proxy

`POST /api/llm/stream`

- accepts Vercel AI SDK compatible chat payloads
- injects the OpenAI-compatible AI Credits credentials from environment
- streams model output back to the sidecar
- records usage events when token data is available

The desktop never receives provider keys.

## STT Proxy

`POST /api/stt`

- accepts audio payloads from the sidecar
- calls Sarvam `saarika:v2.5`
- enforces voice caps by plan

## Cloud RAG API

All Cloud RAG routes require an authenticated Pro/Max user or owner/dev override.

| Route | Purpose |
|---|---|
| `POST /api/rag/sources` | Create a source row before indexing |
| `GET /api/rag/sources` | List current user's sources |
| `POST /api/rag/documents` | Upload extracted text, chunk it, embed it |
| `POST /api/rag/search` | Semantic search over ready chunks |
| `DELETE /api/rag/sources/:id` | Delete one source and its indexed data |

RAG indexing parameters:

- embedding model: `text-embedding-3-small`
- max document chars: `120000`
- chunk size: `1800` chars
- chunk overlap: `220` chars

Search returns compact snippets with source metadata. Backend failures are surfaced to the sidecar as normal API errors; the sidecar treats Cloud RAG as optional context and continues with local memory.

## Implemented Files

- `apps/backend/src/index.ts`
- `apps/backend/src/routes/billing.ts`
- `apps/backend/src/routes/usage.ts`
- `apps/backend/src/routes/llm.ts`
- `apps/backend/src/routes/rag.ts`
- `apps/backend/src/auth.ts`
- `apps/backend/src/usage.ts`

## Future Work

- Background job queue for long document indexing.
- RAG evaluation endpoint and benchmark fixtures.
- Self-serve Max launch switch.
