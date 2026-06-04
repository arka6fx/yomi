# Spec 12 - Backend

## Purpose

Define the Hono backend: Better Auth, billing, usage metering, LLM/STT proxying,
and cloud archive mirroring/search.

## Invariants

- Hono is the backend framework.
- LLM and speech provider keys live only in backend/server environments.
- Razorpay is the payment processor.
- Usage and feature gates are enforced at backend API boundaries.
- Structured memory stays in the sidecar; the backend hosts the mirrored archive
  index for Cloud RAG search.

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

Better Auth validates session cookies and bearer tokens. Desktop uses the
device-code flow and then sends:

```http
Authorization: Bearer <session-token>
```

Authenticated route handlers resolve the current user before applying plan
gates.

## Billing

Billing routes create Razorpay subscriptions and receive webhooks. Webhooks
update the user's `plan`, `subscription_status`, and subscription records.

Current self-serve launch plans:

- `explore`
- `pro`
- `max` (normal purchase/access blocked until launch; owner/dev override can
  still test)

## Usage Metering

`usage_events` is append-only. Daily counters are enforced by usage kind:

| Kind                |               Explore |       Pro |       Max |
| ------------------- | --------------------: | --------: | --------: |
| `fast_query` / chat |       150 trial total | 10000/day | 10000/day |
| `stt` / voice       | included in trial cap |   200/day | 10000/day |
| `agent_run`         |                     0 |         0 | 10000/day |

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
- calls ElevenLabs `scribe_v2`
- enforces voice caps by plan

## Cloud RAG API

Cloud RAG mirrors Yomi-generated archive material from the sidecar into the
backend and exposes search over the mirrored corpus.

Routes in `apps/backend/src/routes/rag.ts`:

| Route                         | Purpose                                                 |
| ----------------------------- | ------------------------------------------------------- |
| `POST /api/rag/sync`          | Upsert mirrored archive sources and delete removed ones |
| `GET /api/rag/sources`        | List current user's mirrored and legacy sources         |
| `POST /api/rag/search`        | Semantic search over ready chunks                       |
| `POST /api/rag/sources`       | Legacy/manual source creation path                      |
| `POST /api/rag/documents`     | Legacy/manual document upload path                      |
| `DELETE /api/rag/sources/:id` | Delete one source and its indexed data                  |

Mirror indexing parameters:

- embedding model: `text-embedding-3-small`
- max document chars: `120000`
- chunk size: `1800` chars
- chunk overlap: `220` chars

Cloud search returns compact snippets with source metadata. The sidecar keeps a
local archive fallback but treats cloud results as primary when available.

## Implemented Files

- `apps/backend/src/index.ts`
- `apps/backend/src/routes/billing.ts`
- `apps/backend/src/routes/usage.ts`
- `apps/backend/src/routes/llm.ts`
- `apps/backend/src/routes/rag.ts`
- `apps/backend/src/auth.ts`
- `apps/backend/src/usage.ts`

## Future Work

- Self-serve Max launch switch.
