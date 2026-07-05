# Spec 01 - Architecture

```text
Desktop Shell (Electron)
  tray/notch UI, hotkeys, mic capture, screen capture
  <-> local authenticated HTTP

Local Sidecar (Bun)
  intent router, fast path, agent path, local notes, local memory
  <-> authenticated HTTPS

Cloud Backend (Hono Worker)
  Better Auth, billing, Telegram gateway, LLM proxy, usage metering, canonical memory

Landing (Next.js)
  marketing, dashboard, billing, downloads, integrations, bot linking
```

The backend is canonical for durable user state. The sidecar is optimized for
low-latency local context and private working state. Telegram never depends on
the desktop being online.

Key backend APIs:

- `/api/auth/*` account and device-code auth.
- `/api/billing/*` subscriptions and credits.
- `/api/gateway/*` Telegram and platform gateway.
- `/api/integrations/*` connector token/status management.
- `/api/rag/*` document/chunk retrieval.
- `/api/memory/*` durable memory facts, provenance, sync, search, and deletion.
