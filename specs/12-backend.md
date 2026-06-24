# Spec 12 - Backend

## Purpose

Define the Hono backend: Better Auth, billing, usage metering, LLM/STT proxying,
and cloud archive mirroring/search.

## Invariants

- Hono is the backend framework.
- LLM and speech provider keys live only in backend/server environments.
- Dodo Payments is the payment processor.
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

Billing routes create Dodo Checkout Sessions and receive webhooks. Webhooks
update the user's `plan`, `subscription_status`, and subscription records.

Current self-serve launch plans:

- `explore`
- `pro`
- `max`

## Usage Metering

`usage_events` is append-only. Daily counters are enforced by usage kind:

| Kind                         | Explore |      Pro |      Max |
| ---------------------------- | ------: | -------: | -------: |
| `fast_query` / chat          |  100/mo | 2,000/mo | 8,000/mo |
| `stt` / voice                |  20 min |  180 min |  750 min |
| `advanced_reasoning`         |    5/mo |   100/mo |   500/mo |
| `image_generation`           |       0 |    30/mo |   200/mo |

Explore is a free monthly tier with strict limits. Pro and Max raise chat,
voice, reasoning, connector, and memory limits.

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

## Memory API

Routes in `apps/backend/src/routes/memory.ts`:

| Route | Purpose |
| --- | --- |
| `POST /api/memory/add` | Add or upsert a durable memory fact |
| `GET /api/memory/entries` | List active durable memories |
| `POST /api/memory/search` | Retrieve memories by topic/content/scope |
| `PATCH /api/memory/:id` | Update and version a memory |
| `POST /api/memory/sync` | Bulk sidecar-to-cloud memory sync |
| `POST /api/memory/forget` | Soft-forget or hard-delete memories |
| `DELETE /api/memory/:id` | Forget or hard-delete one memory |

## Implemented Files

- `apps/backend/src/index.ts`
- `apps/backend/src/routes/billing.ts`
- `apps/backend/src/routes/usage.ts`
- `apps/backend/src/routes/llm.ts`
- `apps/backend/src/routes/rag.ts`
- `apps/backend/src/routes/memory.ts`
- `apps/backend/src/auth.ts`
- `apps/backend/src/usage.ts`
