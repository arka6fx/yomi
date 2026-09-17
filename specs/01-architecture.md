# Spec 01 - Architecture

```text
Cloud Backend (Hono on Cloudflare Workers)
  Better Auth, billing, Telegram gateway, LLM/STT proxy, usage metering, canonical memory

Landing (Next.js on Cloudflare Workers)
  marketing, dashboard, billing, integrations, bot linking

Postgres (Neon) - stateless HTTP driver, pgvector
Assets (R2, optional) - presigned URLs for attachments and avatars
```

The backend is canonical for durable user state.

Key backend APIs:

- `/api/auth/*` account and session auth.
- `/api/billing/*` subscriptions and credits.
- `/api/gateway/*` Telegram and platform gateway.
- `/api/integrations/*` connector token/status management.
- `/api/rag/*` document/chunk retrieval.
- `/api/memory/*` durable memory facts, provenance, sync, search, and deletion.
