# Yomi — Current State (generated 2026-06-14)

> Reconnaissance document. Describes what exists in the repo today. No code was
> changed. "unknown" means the answer could not be established from the code.

## 1. Architecture at a glance

Yomi is a Bun + Turborepo monorepo (`bun@1.3.14`, `workspaces: apps/*, packages/*`).
Three deployable tiers plus helpers:

```
apps/
  backend/        Hono app. Dual runtime: Cloudflare Worker (wrangler.jsonc →
                  src/worker.ts) AND a Bun server (src/index.ts, Bun.serve).
                  Auth, billing, gateway (Telegram/Discord), integrations OAuth,
                  RAG, usage/metering. LLM proxy is DISABLED (returns 410).
  desktop/        Electron (electron-vite + electron-builder). Tray/notch UI
                  (React 18 + zustand + framer-motion). Spawns the sidecar exe,
                  global hotkey, screen/mic capture, device-code auth.
  sidecar/        Bun Hono server on 127.0.0.1:3002. Intent router, fast
                  pipeline (STT→vision→LLM→TTS), LangGraph agent loop, UIA
                  automation, connectors, memory notepad. THE LLM CALL LIVES
                  HERE. Compiled to sidecar-win32-x64.exe and shipped in the
                  desktop installer.
  landing/        Next.js 16 (React 19) marketing + dashboard + /link account
                  linking. Deployed to Cloudflare via wrangler; proxies to backend.
  certification/  Bun CLI harness that runs UIA automation "certification" suites
                  per app (notepad, spotify, office, telegram, …). Dev tool.
  uia-helper/     C#/FlaUI Windows UI Automation helper, single-file win-x64 exe,
                  driven by the sidecar over JSON-RPC stdio (Spec 16).
packages/
  db/             Drizzle schema + Neon serverless Postgres client. 14 SQL
                  migrations (drizzle/0000–0013).
  shared/         TS contracts (GatewayMessage, SseEvent, plans, VAD, chunk).
  eslint-config/  ESLint preset.
  typescript-config/ tsconfig preset.
```

Runtimes: backend = Bun locally / Cloudflare Worker in prod; sidecar = Bun
(compiled to a standalone Windows exe); desktop = Electron/Node; landing =
Next.js on Cloudflare; uia-helper = .NET. Desktop target is Windows-only
(`os: "windows"`, only a win32-x64 sidecar build target exists).

Note on backend runtime: `src/worker.ts` is the Cloudflare entry; it copies
`env` onto `process.env` then delegates to the same Hono `app` exported from
`src/index.ts`. The Bun-only `Bun.serve` block in `index.ts:129` is skipped
under Workers. `wrangler.jsonc` has `nodejs_compat_v2`.

## 2. How a chat message flows today

**The LLM call is made from the local sidecar, NOT the backend.** This is the
single most important finding.

Desktop chat path:
1. Desktop renderer → Electron main IPC (`apps/desktop/src/main/ipc.ts`).
2. Main posts to the local sidecar over HTTP:
   `fetch(\`${sidecar.baseUrl}${endpoint}\`)` where `baseUrl =
   http://127.0.0.1:3002` and `endpoint = "/query/agent" | "/query/fast"`
   (`ipc.ts:568,599`), authenticated with header `x-sidecar-secret`. Response is
   an SSE stream.
3. Sidecar `apps/sidecar/src/index.ts` handles `/query` → `classifyIntent`
   (`router/intent.ts`) → `fastPipeline` (`pipeline/fast.ts`) or the agent driver.
   Agent driver defaults to the LangGraph orchestrator (`graph/run.ts`); set
   `YOMI_LEGACY_AGENT=1` for the AI-SDK ReAct loop (`pipeline/agent.ts`).
4. The actual model HTTP request is in `apps/sidecar/src/pipeline/model.ts`
   (`createModel` → `POST {AI_CREDITS_BASE_URL}/chat/completions`, bearer
   `AI_CREDITS_API_KEY`, default model `gpt-4.1-mini`). It is a hand-rolled
   `LanguageModelV1` provider (Vercel AI SDK `ai@^4`) for an OpenAI-compatible
   endpoint. Default base URL falls back to `api.openai.com/v1`; prod sets
   `AI_CREDITS_BASE_URL=https://api.aicredits.in/v1`.

Backend LLM endpoints are intentionally off:
- `apps/backend/src/routes/llm.ts` → `POST /api/llm/stream` returns HTTP 410
  ("Backend LLM proxy is disabled. Use the local sidecar AI Credits path.").
- `apps/backend/src/routes/proxy.ts` (`/api/v1`) is an empty stub; legacy cloud
  LLM/STT/TTS proxy removed.

So every model token — desktop chat AND Telegram replies — is produced by the
user's sidecar process. The backend has no model-calling code path.

## 3. Feature inventory

- **Chat (text/voice):** Lives in the sidecar fast/agent pipelines. Voice input
  is transcribed by the sidecar (`/stt`, `pipeline/fast.ts` `resolveText`) before
  routing. Desktop drives it over local HTTP+SSE.
- **Screenshot analysis:** Capture is in the desktop main process
  (`apps/desktop/src/main/capture.ts`); the base64 screenshot is sent as
  `screenshot_b64` in the `/query` body and passed to the vision-capable model in
  the sidecar (`model.ts` supports `image_url` content parts). On-screen text
  analysis is part of the fast pipeline, not the backend.
- **STT / TTS:** Sidecar-only, ElevenLabs.
  - STT: `apps/sidecar/src/speech/transcribe.ts` → `services/elevenlabs/stt.ts`
    (`scribe_v2`). The backend STT route (`routes/stt.ts`) is commented out in
    `index.ts` as "legacy ElevenLabs".
  - TTS: `apps/sidecar/src/speech/resolver.ts` → `services/elevenlabs/tts.ts`
    (`eleven_flash_v2_5`); `TTS_ENGINE=elevenlabs|none`.
- **Telegram bot:** Backend gateway, **long-polling** (`getUpdates`).
  - `apps/backend/src/gateway/platforms/telegram.ts`: `TelegramAdapter` polls
    `GET {api}/getUpdates` every 3 s (`POLL_INTERVAL_MS = 3000`); no webhook.
  - Started in `gateway-runner.ts` `start()` when `TELEGRAM_BOT_TOKEN` is set;
    `getDefaultGateway().start()` is invoked at backend boot (`index.ts:117`).
  - On an incoming message (`GatewayRunner.onIncoming`): if the platform user is
    not linked, it generates a 6-char linking code and replies with a prompt
    (also supports `/start <token>` deep-link linking, gated by
    `TELEGRAM_DEEP_LINK_ENABLED=true`). If linked, it resolves the Yomi user,
    queues the message, logs a `gateway_message` usage event, and
    **forwards it to that user's sidecar**: `sendToSidecar` →
    `POST {sidecarUrl}/gateway/receive` (Bearer `SIDECAR_SECRET`), where
    `sidecarUrl` comes from `devices.sidecarUrl` via the `SidecarResolver`.
  - The sidecar also independently **polls** the backend:
    `apps/sidecar/src/gateway/receive.ts` `startGatewayPoll` →
    `GET /api/gateway/pending` every 2 s (needs `YOMI_SESSION_TOKEN`).
  - Either way the message reaches `handleGatewayMessage` in the sidecar, which
    runs the fast/agent pipeline (LLM) and posts the reply back via
    `POST /api/gateway/send` → backend → Telegram `sendMessage`.
  - **Net: the Telegram bot has a path to the LLM and to user/connector data
    ONLY through the user's running sidecar. With the desktop closed there is no
    backend code that answers a Telegram message.**
  - Chat-to-user binding IS stored: `platform_connections` maps
    (platform, platform_user_id) → Yomi `user_id` (plus `linking_codes` and
    `telegram_link_tokens` for onboarding).
- **Discord bot:** Also present in the gateway (`platforms/discord.ts`,
  gateway-wide OAuth `identify` + `/link` slash flow). Same sidecar-forward model.

## 4. Auth & data model

- **Better Auth is wired up** (`apps/backend/src/auth.ts`), Drizzle adapter on
  Postgres, providers Google + GitHub (`socialProviders`), plus `organization`,
  `bearer`, and `customSession` plugins. User PKs are **UUID**
  (`packages/db/src/schema.ts:26`, `users.id uuid defaultRandom`). The Bearer
  plugin lets the sidecar/landing present `Authorization: Bearer <token>`.
- Auth middleware: `authenticate(c, next)` validates a session from cookie or
  bearer and sets `c.get("user")`.
- Custom auth routes exist for the **device-code flow** used by desktop
  (`routes/auth-routes.ts`, `/api/auth/device-code[...]`), keeping login out of
  the Electron window. Owner accounts are elevated to `role=owner, plan=max` via
  an allowlist (`OWNER_EMAIL(S)/OWNER_USER_IDS`, `entitlements.ts`).
- User table is extended (in `auth-schema.ts`, referenced by `auth.ts`
  `getUserFields`): `role`, `plan`, `subscriptionStatus`, `trial*`,
  `daily{Chat,Voice,Image}Count`, `agentUsageCount`, `dodoCustomerId`,
  `dodoSubscriptionId`, etc.
- **Drizzle tables** (`packages/db/src/schema.ts`, app tables): `user` (mirror),
  `devices` (note `sidecar_url` column — used to route gateway messages),
  `subscriptions`, `usage_events` (append-only), `credit_accounts`,
  `payment_records`, `credit_grants`, `credit_transactions`,
  `processed_payment_events`, `agent_runs`, `memory_blobs`, RAG tables
  (`rag_sources/documents/chunks/embeddings` with `vector(1536)` +
  `rag_retrieval_logs`), `mcp_connections`, `hook_logs`, `platform_connections`,
  `linking_codes`, `telegram_link_tokens`.
- **Per-user secret/token storage exists and is encrypted.**
  `mcp_connections.oauth_tokens` is "AES-256-GCM encrypted JSON" written by
  `services/token-encryption.ts` (`ENCRYPTION_KEY`). This is where connector
  OAuth tokens live — **already on the backend, not the desktop.**

## 5. Connectors / integrations

There IS a real connector — **Google / Gmail** — not just scaffolding:

- Backend OAuth + token vault: `apps/backend/src/routes/integrations.ts`
  (`/api/integrations/*`): `connect/google` (offline access, forces
  refresh_token), `callback/google` (exchanges code, stores encrypted tokens in
  `mcp_connections` with `displayName`/`lastSyncAt`), `GET /` and `/status`
  (list connected providers), `DELETE /:provider` (revoke + delete), and a
  **sidecar-only** `GET /token/:provider` that returns a fresh (auto-refreshed)
  access token, gated by `x-sidecar-secret`.
- Sidecar consumer: `apps/sidecar/src/connectors/` — `ConnectorRegistry`
  (`registry.ts`) fetches `/api/integrations/status`, and
  `GoogleGmailConnector` (`google-gmail.ts`) calls the Gmail REST API
  (search/read/unread/send) using a token pulled from the backend's
  `/token/google` endpoint. Registry is built per user; only `google` is wired,
  with a `// Future: notion, slack, github` placeholder.
- **No** Notion / GitHub / Slack connectors, and **no** aggregator
  (Composio/Nango). Slack/WhatsApp adapters were removed (per AGENTS.md).
- MCP: `apps/sidecar/src/mcp/` (client + safety) and Playwright MCP dep exist,
  but MCP client wiring is commented out in the sidecar entry (`// closeMcp …
  will provide later`). Browser automation is hidden.
- Architecturally important: connector **token storage is already
  backend-resident**, but the connector **execution logic and the LLM that
  orchestrates it both run in the sidecar.**

## 6. Config & secrets

Env contract from `.env.example` (read via `process.env`; backend also injects
Cloudflare `env` → `process.env` in `worker.ts`; sidecar and desktop each parse a
`.env` file manually since compiled/packaged binaries don't inherit `--env-file`,
see `sidecar/src/index.ts` `loadDotEnv` and `desktop/src/main/sidecar.ts`):

- DB: `DATABASE_URL` (Neon).
- Auth: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_BASE_URL`,
  `OWNER_EMAIL(S)`, `OWNER_USER_IDS`, `GOOGLE_CLIENT_ID/SECRET`,
  `GITHUB_CLIENT_ID/SECRET`.
- Integrations OAuth (separate from login): `GOOGLE_INTEGRATIONS_CLIENT_ID`,
  `GOOGLE_INTEGRATIONS_CLIENT_SECRET`, `GOOGLE_INTEGRATIONS_REDIRECT_URI`
  (referenced in `integrations.ts`; not in `.env.example` — see open questions),
  plus `ENCRYPTION_KEY` (AES-256-GCM for `oauth_tokens`).
- LLM: `AI_CREDITS_API_KEY`, `AI_CREDITS_BASE_URL`, `AI_CREDITS_FAST_MODEL`
  (`gpt-4.1-mini`), `AI_CREDITS_AGENT_MODEL` (`gpt-4.1`),
  `AI_CREDITS_EMBEDDING_MODEL` (`text-embedding-3-small`). Model selection is
  env-swappable.
- Speech: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_STT_MODEL`
  (`scribe_v2`), `ELEVENLABS_TTS_MODEL` (`eleven_flash_v2_5`), `TTS_ENGINE`.
- Billing (Dodo): `DODO_ENV`, `DODO_{TEST,LIVE}_API_KEY`,
  `DODO_{TEST,LIVE}_WEBHOOK_SECRET`, `DODO_*_PRODUCT_*` ids (also baked as
  non-secret `vars` in `wrangler.jsonc`).
- Gateway/transport: `SIDECAR_SECRET` (backend↔sidecar shared secret),
  `SIDECAR_URL` (default `http://localhost:3002`), `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_BOT_USERNAME`, `TELEGRAM_DEEP_LINK_ENABLED`, `DISCORD_BOT_TOKEN`,
  `DISCORD_CLIENT_ID/SECRET`, `DISCORD_REDIRECT_URI`.
- App URLs: `BACKEND_URL`, `YOMI_BACKEND_URL`, `YOMI_APP_URL`,
  `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_APP_URL`, `CORS_ORIGIN`.
- Desktop injects into the sidecar process: `SIDECAR_SECRET`,
  `YOMI_SESSION_TOKEN`, `YOMI_BACKEND_URL`, `YOMI_UIA_HELPER`
  (`desktop/src/main/sidecar.ts`).
- Misc: `CONTEXT7_API_KEY`, `YOMI_PLAN`, `YOMI_LEGACY_AGENT`, `SIDECAR_PORT`.

Secrets are read from `process.env` everywhere; production backend secrets come
from Cloudflare (wrangler secrets/vars), local from `.env`.

## 7. Gap analysis vs. backend-centric target

Today the system is **desktop-centric for intelligence and backend-centric only
for identity/billing/token-storage.** The backend already owns the right data —
Better Auth users, `platform_connections` (Telegram↔user binding), and encrypted
connector tokens in `mcp_connections`. But the backend cannot *think*: the LLM
call, the agent loop, the memory/RAG retrieval, and the connector execution all
live in the sidecar, and the gateway answers a Telegram message only by
forwarding to the user's running sidecar (`{sidecarUrl}/gateway/receive`) or
having that sidecar poll `/api/gateway/pending`. So the target — "Telegram
queries Notion/Google data with the desktop closed" — is **not achievable today**;
it requires a running desktop.

Biggest structural change: stand up a backend-side execution path (LLM call +
agent loop + connector calls, reusing `mcp_connections` tokens directly instead
of relaying through the sidecar) so a gateway message can be fully answered
server-side. The good news is the seams already exist: a model provider shaped
like `sidecar/src/pipeline/model.ts`, connectors shaped like
`sidecar/src/connectors/`, and the backend's own `/token/:provider` vault could
be reused; the work is relocating/duplicating execution into the Worker, not
re-architecting auth or storage.

## 8. Open questions / risks

- `routes/integrations.ts` reads `GOOGLE_INTEGRATIONS_CLIENT_ID/SECRET/REDIRECT_URI`,
  but `.env.example` only documents the login `GOOGLE_CLIENT_ID/SECRET`. Whether
  integrations reuse the login OAuth app or need a separate one is unknown.
- `mcp_connections` uses two `userId` column types across the codebase:
  `schema.ts` declares it `uuid` referencing `user.id`, while several newer
  tables (`credit_*`, `rag_*`, `platform_connections`) declare `user_id` as
  `text`. Mixed `uuid`/`text` FKs to the same `user.id` is a latent typing/FK
  risk worth confirming against the live DB.
- `packages/db/src/schema.ts` is **stale relative to migrations**: it lacks the
  `mcp_connections.display_name` / `last_sync_at` columns that migration
  `0013_integrations.sql` adds and that `integrations.ts` selects. Runtime works
  (columns exist via migration) but Drizzle's typed schema is out of sync.
- Backend runs the gateway with **in-memory** session/pending-message state
  (`GatewayRunner.sessions`, `pendingMessages` Maps) and Telegram long-polling
  with a single `lastUpdateId`. On Cloudflare Workers (no long-lived process /
  multiple isolates) a 3 s `setInterval` poller and in-memory queues are unlikely
  to behave correctly — unclear whether the gateway actually runs under Workers
  or only under the Bun (`index.ts`) deployment. This needs confirmation.
- Two delivery mechanisms for gateway messages coexist (backend push to sidecar
  AND sidecar poll of `/pending`); whether both are active simultaneously could
  cause duplicate handling.
- `YOMI_SESSION_TOKEN` gates the sidecar's gateway poll; how/when the desktop
  obtains and rotates it (and registers `devices.sidecar_url`) was not traced in
  this pass.
- Several agent/automation subsystems are large but partially commented out in
  the sidecar entry (`mcp`, automation replay/providers/knowledge routes,
  browser automation) — present in the tree but not all wired into the running
  server.

---

### Top findings
- **The LLM call lives in the local sidecar** (`apps/sidecar/src/pipeline/model.ts`,
  OpenAI-compatible AI Credits endpoint). The backend's LLM proxy returns HTTP
  410 — the backend never calls a model.
- **The Telegram bot uses long-polling** (`getUpdates` every 3 s) inside the
  backend gateway; no webhook.
- **Telegram cannot answer with the desktop closed:** the gateway only forwards
  messages to the user's running sidecar (or that sidecar polls for them); all
  intelligence is sidecar-side.
- **Backend already owns the right state for the target:** Better Auth users,
  `platform_connections` (chat↔user binding), and **encrypted connector tokens**
  in `mcp_connections`. One real connector exists (Google/Gmail); execution runs
  in the sidecar.
- **Biggest gap:** no server-side execution path — move LLM + agent loop +
  connector calls into the backend to decouple from the desktop.
