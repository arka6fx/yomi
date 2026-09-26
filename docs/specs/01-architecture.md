# Spec 01 - Architecture

```text
Backend (FastAPI in a Cloudflare Container, behind the yomi-backend Worker)
  auth, billing, metering, Telegram gateway, agent loop, memory, RAG, connectors

Storage (yomi-storage gateway Worker)
  D1 (relational) · Vectorize (embeddings) · R2 (media, ingest)

Web (Next.js on Cloudflare Workers)
  marketing, sign-in, dashboard, billing, integrations

Computer (apps/sandbox)
  per-user Chrome desktop for computer use
```

The backend is canonical for durable user state. The web app reaches it only
through `/api/*`. See [`../architecture.md`](../architecture.md) for the full
design.

Key backend APIs:

- `/api/auth/*`: sign-in (Telegram, Google, GitHub) and sessions.
- `/api/billing/*`: plans, subscriptions, credit packs, Dodo webhooks.
- `/api/gateway/*`: the Telegram webhook.
- `/api/integrations/*`: connector connection and status.
- `/api/memory/*`: durable memory facts, provenance, search, and deletion.
- `/api/rag/*`: source indexing and retrieval.
- `/api/schedules/*`: routines.
- `/internal/*`: cron dispatch and inbound email, called only by the Worker.
