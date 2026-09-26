# Spec 12 - Backend

## Purpose

Define the FastAPI backend: auth, billing, usage metering, the Telegram gateway,
the agent loop, memory, and RAG.

## Invariants

- The backend is Python FastAPI in a Cloudflare Container behind the
  `yomi-backend` Worker. It is the only backend.
- Data lives in Cloudflare D1, Vectorize, and R2, reached through the storage
  gateway Worker (spec 11).
- Model access (Workers AI) and every provider key live only in the backend
  environment. Clients never receive them.
- Dodo Payments is the payment processor.
- Plans are Free and Pro. Every billable action goes through
  `services/billing_d1.py` `charge_usage()`, which logs usage but no longer
  debits or blocks (credits are retired).
- Memory and RAG are backend-canonical.

## Routers

All routers are mounted in `apps/api/src/yomi/app/main.py`:

| Prefix              | Module                                                   |
| ------------------- | -------------------------------------------------------- |
| `/api/auth`         | `app/routes/auth.py`                                     |
| `/api/billing`      | `app/routes/billing.py`                                  |
| `/api/usage`        | `app/routes/usage.py`                                    |
| `/api/llm`          | `app/routes/llm.py`                                      |
| `/api/memory`       | `app/routes/memory.py`                                   |
| `/api/rag`          | `app/routes/rag.py`                                      |
| `/api/schedules`    | `app/routes/schedules.py`                                |
| `/api/integrations` | `app/routes/integrations.py`                             |
| `/api/gateway`      | `gateway/routes.py` (Telegram webhook)                   |
| `/internal/*`       | `app/routes/ops.py`, `app/routes/email.py` (Worker only) |

## Auth

Sessions are Better Auth–compatible cookies (or
`Authorization: Bearer <token>`), validated in `app/deps.py`. Sign-in methods
are Telegram (a one-time code approved in the bot; see
`services/telegram_login_d1.py`), Google OAuth, and GitHub OAuth. Authenticated
handlers resolve the current user before applying plan gates. `/internal/*`
routes require the `x-yomi-internal` header to match `INTERNAL_API_KEY`.

## Billing

Billing routes create Dodo checkout sessions for Pro and receive webhooks at
`POST /api/billing/webhook`. Webhooks update the user's `plan`,
`subscription_status`, and payment records.

Self-serve plans: `explore` (shown as Free) and `pro`. The retired `max` plan is
treated as `pro`; credit-pack purchases are refused.

## Usage and limits

`usage_events` is append-only. `billing_d1.charge_usage()` records one row per
billable action (chat, image, voice, agent run) for cost visibility and returns
success; it never debits or blocks. The plan differences are enforced elsewhere:

- **Routines:** `SCHEDULE_LIMITS` in `services/schedule_parser.py` (Free 3, Pro
  unlimited), checked by `schedules_d1.ensure_schedule_capacity()`.
- **Engine:** Pro runs agent turns with reasoning effort high
  (`services/agent/loop.py`); Free uses the fast path.

See spec 13.

## LLM proxy

`POST /api/llm/stream` streams Workers AI output for authenticated clients,
injecting credentials server-side and recording usage.

## Voice notes

There is no client-facing speech endpoint. Incoming Telegram voice notes are
downloaded and transcribed inline by the gateway through
`services/transcription.py` (`whisper-large-v3-turbo`) and charged per minute.
Yomi never replies with synthesized voice. Every reply is text.

## RAG API

| Route                          | Purpose                                         |
| ------------------------------ | ----------------------------------------------- |
| `POST /api/rag/sources`        | Create a source (text or URL)                   |
| `GET /api/rag/sources`         | List the user's sources                         |
| `POST /api/rag/sync`           | Upsert mirrored sources and delete removed ones |
| `POST /api/rag/documents`      | Upload a document                               |
| `POST /api/rag/drive/sources`  | Add a Google Drive folder or file               |
| `POST /api/rag/drive/backfill` | Index existing Drive content                    |
| `POST /api/rag/drive/sync`     | Pull Drive changes                              |
| `POST /api/rag/search`         | Semantic search over ready chunks               |
| `DELETE /api/rag/sources/{id}` | Delete a source and its indexed data            |

Indexing parameters: embedding model `bge-base-en-v1.5` (768 dimensions), at
most 120,000 characters per document, 1,800-character chunks with 220 characters
of overlap.

## Memory API

| Route                         | Purpose                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| `POST /api/memory/add`        | Add or upsert a durable fact                               |
| `GET /api/memory/entries`     | List active memories                                       |
| `GET /api/memory/graph`       | Memory graph for the dashboard                             |
| `GET /api/memory/superseded`  | Memories replaced by newer facts                           |
| `POST /api/memory/search`     | Retrieve memories by topic, content, or scope              |
| `POST /api/memory/profile`    | Profile facts about the user, optionally ranked by a query |
| `POST /api/memory/graph-walk` | Traverse related memories                                  |
| `PATCH /api/memory/{id}`      | Update and version a memory                                |
| `POST /api/memory/sync`       | Bulk upsert and removal                                    |
| `POST /api/memory/forget`     | Soft-forget or hard-delete memories                        |
| `DELETE /api/memory/{id}`     | Forget or hard-delete one memory                           |

Memory and RAG routes require the matching privacy consent (`memory`,
`cloud_memory`).

## Key files

- `apps/api/src/yomi/app/main.py`: app factory and router mounts
- `apps/api/src/yomi/app/deps.py`: session validation
- `apps/api/src/yomi/gateway/telegram.py`: Telegram gateway
- `apps/api/src/yomi/services/agent/loop.py`: agent loop
- `apps/api/src/yomi/services/billing_d1.py`: plans, subscriptions,
  `charge_usage`
- `apps/api/src/yomi/shared/plans.py`: plan definitions
- `apps/api/src/yomi/services/transcription.py`: speech-to-text
- `apps/api/src/yomi/services/memory/`, `services/rag/`: memory and RAG
