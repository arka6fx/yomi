# Spec 12 - Backend

## Purpose

Define the Hono backend: Better Auth, billing, usage metering, LLM/STT proxying,
and cloud archive mirroring/search.

## Invariants

- Hono is the backend framework.
- LLM and speech provider keys live only in backend/server environments.
- Dodo Payments is the payment processor.
- Usage is gated by a single credit balance (pure-credit model) at backend API
  boundaries; `services/metering.ts` `chargeUsage()` is the only charging
  chokepoint.
- Memory is backend-canonical; the backend hosts the archive index for RAG
  search.

## Route Groups

```ts
app.route("/api/billing", billingRoutes)
app.route("/api/usage", usageRoutes)
app.route("/api/llm", llmRoutes)
app.route("/api/rag", ragRoutes)
app.on(["GET", "POST"], "/api/auth/*", auth.handler)
```

## Auth

Better Auth validates session cookies and bearer tokens. Clients authenticate
via OAuth flows and send:

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

`usage_events` is append-only. Usage is gated purely by the credit balance —
there are no per-feature monthly caps. Every billable action goes through
`services/metering.ts` `chargeUsage({ user, kind, durationSeconds? })`:

1. Owner email → record event, no charge, bypass.
2. `hasBillablePlanAccess` (Explore trial active / paid sub active / past_due
   grace).
3. `balance >= creditsForUsage(kind)` else block — Explore →
   `subscription_required`, Pro/Max → `credits_exhausted`.
4. Insert `usage_events` row, `consumeCredits`, write back `creditsCharged`.

Credit costs: chat 1 · image/screen analyze 1 · voice 2/min · Telegram
message 1. Monthly allotments: Explore 100, Pro 2,500, Max 10,000. See spec 13.
Callers: `routes/usage.ts` (`POST /interactions/reserve`), `agent/run.ts`
(Telegram bot_message), `gateway/gateway-runner.ts` (telegram voice/image).

## LLM Proxy

`POST /api/llm/stream`

- accepts Vercel AI SDK compatible chat payloads
- injects the OpenAI-compatible credentials from environment
- streams model output back to the client
- records usage events when token data is available

Clients never receive provider keys directly.

## Voice Notes

There is no client-facing STT/TTS HTTP proxy. Incoming Telegram voice notes are
downloaded and transcribed inline by the gateway via `services/transcription.ts`
(OpenAI `gpt-4o-mini-transcribe`); the transcript is charged at
`recordGatewayCreditAddon` (kind `request_voice`, per actual minute). Yomi never
replies with synthesized voice — every reply is text.

## Cloud RAG API

Cloud RAG indexes Yomi-generated archive material and exposes search over the
corpus.

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

Cloud search returns compact snippets with source metadata.

## Memory API

Routes in `apps/backend/src/routes/memory.ts`:

| Route                     | Purpose                                  |
| ------------------------- | ---------------------------------------- |
| `POST /api/memory/add`    | Add or upsert a durable memory fact      |
| `GET /api/memory/entries` | List active durable memories             |
| `POST /api/memory/search` | Retrieve memories by topic/content/scope |
| `PATCH /api/memory/:id`   | Update and version a memory              |
| `POST /api/memory/sync`   | Bulk upsert/removal of memories          |
| `POST /api/memory/forget` | Soft-forget or hard-delete memories      |
| `DELETE /api/memory/:id`  | Forget or hard-delete one memory         |

## Implemented Files

- `apps/backend/src/index.ts`
- `apps/backend/src/routes/billing.ts`
- `apps/backend/src/routes/usage.ts`
- `apps/backend/src/services/transcription.ts`
- `apps/backend/src/routes/llm.ts`
- `apps/backend/src/routes/rag.ts`
- `apps/backend/src/routes/memory.ts`
- `apps/backend/src/services/metering.ts` (`chargeUsage` chokepoint)
- `apps/backend/src/services/credit-ledger.ts`,
  `apps/backend/src/services/credit-pricing.ts`
- `apps/backend/src/gateway/gateway-runner.ts`, `apps/backend/src/agent/run.ts`
- `apps/backend/src/auth.ts`
