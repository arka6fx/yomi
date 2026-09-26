# Architecture

Yomi is one Python backend behind a thin Cloudflare Worker, plus a Next.js web
app and a computer-use sandbox. Everything runs on Cloudflare.

## System overview

```text
                      ┌───────────────────────────────┐
 Telegram webhook ───►│  yomi-backend Worker          │◄── Email Routing (mail.getyomi.in)
 Dashboard /api/* ───►│  apps/api/containers/worker.ts│◄── Cron (every 10 min)
                      └──────────────┬────────────────┘
                                     │ fetch + forwarded secrets
                                     ▼
                      ┌───────────────────────────────┐
                      │  FastAPI container            │
                      │  apps/api/src/yomi            │
                      │  gateway · agent loop · auth  │
                      │  billing · memory · RAG       │
                      └──┬──────────┬──────────┬──────┘
                         │          │          │
          HTTPS + secret │          │ REST     │ HTTPS + secret
                         ▼          ▼          ▼
          ┌────────────────┐ ┌────────────┐ ┌─────────────────────┐
          │ yomi-storage   │ │ Workers AI │ │ Computer Worker     │
          │ Worker         │ │ Browser Run│ │ apps/sandbox        │
          │ D1 · Vectorize │ │ Composio   │ │ Chrome desktop per  │
          │ R2             │ │ Google APIs│ │ user (Sandbox SDK)  │
          └────────────────┘ └────────────┘ └─────────────────────┘
```

| Component         | Source                                                                  | Deployed as                            |
| ----------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| Backend Worker    | `apps/api/containers/worker.ts`, `apps/api/wrangler.toml`               | `yomi-backend` on `api.getyomi.in`     |
| Backend container | `apps/api/src/yomi/`, `apps/api/Dockerfile`                             | Cloudflare Container `YomiContainer`   |
| Storage gateway   | `apps/api/containers/storage.ts`, `apps/api/wrangler.storage-prod.toml` | `yomi-storage` Worker                  |
| Web app           | `apps/web/`                                                             | `yomi-landing` Worker on `getyomi.in`  |
| Computer gateway  | `apps/sandbox/`                                                         | `yomi-computer` Worker + desktop image |

## Backend Worker

The Worker is intentionally thin. It has three entry points:

- **`fetch`** forwards every HTTP request to the container. While a hibernated
  container wakes up (`sleepAfter = 5m`), it retries the transient "not
  listening" failures with backoff and passes real application errors through
  untouched.
- **`scheduled`** runs every 10 minutes and calls `POST /internal/dispatch`.
  That fires due routines, expires lapsed plans, and recovers agent runs whose
  executor died.
- **`email`** receives mail for `*@mail.getyomi.in` from Cloudflare Email
  Routing and posts the raw MIME to `/internal/inbound-email`. Unknown addresses
  are rejected at SMTP time.

Secrets are Worker Secrets. The Worker forwards them to the container through
its `envVars` mapping.

## Backend container

FastAPI on uvicorn, port 8080 (`yomi.run:app`). Main areas:

| Path                                | Responsibility                                                         |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `gateway/telegram.py`               | Telegram webhook: messages, voice, photos, inline buttons, web sign-in |
| `services/agent/`                   | Tool-calling agent loop, tool registry, sessions                       |
| `connectors/`                       | First-class Gmail, Calendar, Drive tools and the Composio bridge       |
| `services/memory/`, `services/rag/` | Long-term memory and retrieval                                         |
| `services/metering.py`              | The single chokepoint that charges credits                             |
| `services/computer/`                | Client for the computer gateway                                        |
| `services/*_d1.py`                  | Data access over D1                                                    |
| `app/routes/`                       | REST API used by the dashboard (`/api/*`)                              |

### Agent runs

A Telegram message is recorded as an **agent run** in D1, acknowledged
immediately, and executed in the background. The loop calls Workers AI through
its OpenAI-compatible endpoint, runs tools, and streams progress as Telegram
reactions. Actions with side effects (sending mail, booking, paying, deleting)
create a **pending action** that the user must approve. Runs that die mid-flight
are reclaimed by the dispatch sweep.

### Models

| Use                         | Model                                                                     |
| --------------------------- | ------------------------------------------------------------------------- |
| Chat, agent, search, vision | `@cf/zai-org/glm-5.3-flash` (reasoning low for chat, high for agent runs) |
| Speech-to-text              | `@cf/openai/whisper-large-v3-turbo`                                       |
| Embeddings                  | `@cf/baai/bge-base-en-v1.5` (768 dimensions)                              |

The model stays fixed for the whole turn: switching mid-turn loses the prompt
cache and breaks tool-vocabulary consistency.

## Storage

The container has no native Cloudflare bindings. It talks to the **storage
gateway Worker**, which holds them, over HTTPS authenticated with
`STORAGE_GATEWAY_SECRET`:

| Binding     | Service                        | Holds                                                                  |
| ----------- | ------------------------------ | ---------------------------------------------------------------------- |
| `DB`        | D1 (`yomi-prod`)               | Users, sessions, billing, runs, memory, RAG metadata, schedules, vault |
| `VECTORS`   | Vectorize (`yomi-vectors-768`) | Memory and RAG embeddings, namespaced per user                         |
| `R2_MEDIA`  | R2 (`yomi-media`)              | User uploads such as profile photos                                    |
| `R2_INGEST` | R2 (`yomi-ingest`)             | Short-lived Drive-sync content                                         |

The schema lives in `apps/api/migrations-d1/` as numbered SQL files.
`STORAGE_BACKEND=d1` is the default. The earlier Postgres path (SQLAlchemy
models in `packages/db`, Alembic in `apps/api/migrations`) is kept only as a
fallback and is not used in production.

## Web app

`apps/web` is a Next.js app with the marketing site, sign-in, and the dashboard.
It rewrites `/api/*` to the backend and never reads storage itself. Sign-in uses
Telegram (a one-time code approved in the bot), with Google and GitHub OAuth as
alternatives. Sessions are cookies validated by the backend.

## Computer use

Two mechanisms:

- **Browser Run** (Cloudflare REST API) for stateless scraping, screenshots, and
  extraction.
- **The computer gateway** (`apps/sandbox`) for a persistent desktop: one
  isolated Linux sandbox per user running Xvfb, Chrome, and a control service.
  The Chrome profile is backed up so logins survive restarts. The dashboard
  shows it live.

## Security model

- OAuth tokens and vault items are encrypted at rest (`ENCRYPTION_KEY`, with
  `ENCRYPTION_KEY_FALLBACKS` for rotation).
- The agent never receives raw vault secrets; it fills them through tools.
- Irreversible actions require explicit approval. See
  [ADR 0005](./adr/0005-capability-based-security-model.md).
- Logs are PII-redacted. LLM telemetry records metadata, never content.

## Further reading

- [Production runbook](./runbook.md)
- [Architecture decision records](./adr/)
- [Product specifications](./specs/README.md)
