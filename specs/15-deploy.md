# Spec 15 — Deploy

## Purpose

Deploy `apps/backend` to a hosted Bun environment (Railway/Fly.io) and `apps/landing` to Cloudflare Pages (via `@opennextjs/cloudflare`). Both apps run on Cloudflare's edge network for the landing, and on long-running Bun processes for the backend.

## Invariants

- API keys and secrets live only in environment variables — never committed.
- `@neondatabase/serverless` with `drizzle-orm/neon-http` is already Workers-compatible (HTTP, not TCP). No changes to the DB client.
- Binary downloads never served from Workers/Pages — always GitHub Releases.
- `main` branch = production for both apps.

## Detailed Design

### Backend — Railway / Fly.io (Bun)

The backend runs Hono on Bun (`bun run dev` in production). No special adapter needed.

#### Package.json scripts

```json
"scripts": {
  "dev": "bun run --hot src/index.ts",
  "start": "bun run src/index.ts",
  "deploy": "bun run start"
}
```

#### Config

No config file needed. Exposes `app.fetch` on `$PORT` (default 3001).

#### Secrets (set via Railway/Fly.io dashboard or CLI)

```
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
ENCRYPTION_KEY
OPENAI_API_KEY
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
SIDECAR_SECRET
```

---

### Landing — Cloudflare Pages + OpenNext

`@opennextjs/cloudflare` compiles Next.js output into a Worker that Pages can serve.

#### `open-next.config.ts`

```typescript
import type { OpenNextConfig } from "@opennextjs/cloudflare"
const config: OpenNextConfig = {}
export default config
```

#### `wrangler.json`

```json
{
  "name": "yomi-landing",
  "compatibility_date": "2025-05-01",
  "compatibility_flags": ["nodejs_compat"],
  "pages_build_output_dir": ".open-next/assets"
}
```

#### Package.json scripts

```json
"scripts": {
  "dev": "next dev --port 3000",
  "build": "opennextjs-cloudflare build",
  "deploy": "opennextjs-cloudflare build && wrangler pages deploy",
  "preview": "wrangler pages dev .open-next/assets"
}
```

#### Environment variables (Pages dashboard → Settings → Environment variables)

```
BACKEND_URL             = https://yomi-backend.railway.app
NEXT_PUBLIC_BACKEND_URL = https://yomi-backend.railway.app
```

---

### Environment variable reference

| Variable | Backend | Landing | Secret? |
|---|---|---|---|
| `DATABASE_URL` | ✓ | — | yes |
| `BETTER_AUTH_SECRET` | ✓ | — | yes |
| `BETTER_AUTH_URL` | ✓ | — | no |
| `GOOGLE_CLIENT_ID` | ✓ | — | yes |
| `GOOGLE_CLIENT_SECRET` | ✓ | — | yes |
| `GITHUB_CLIENT_ID` | ✓ | — | yes |
| `GITHUB_CLIENT_SECRET` | ✓ | — | yes |
| `ENCRYPTION_KEY` | ✓ | — | yes |
| `OPENAI_API_KEY` | ✓ | — | yes; AI Credits API key |
| `OPENAI_BASE_URL` | ✓ | — | AI Credits OpenAI-compatible base URL |
| `RAZORPAY_KEY_ID` | ✓ | — | yes |
| `RAZORPAY_KEY_SECRET` | ✓ | — | yes |
| `RAZORPAY_WEBHOOK_SECRET` | ✓ | — | yes |
| `SIDECAR_SECRET` | ✓ | — | yes |
| `BACKEND_URL` | — | ✓ | no |
| `NEXT_PUBLIC_BACKEND_URL` | — | ✓ | no |

---

### Local development

```bash
# Backend
cd apps/backend && bun run dev   # :3001

# Landing
cd apps/landing
echo "BACKEND_URL=http://localhost:3001" >> .env.local
bun run dev   # :3000
```

### Deployment sequence

```bash
# 1. Deploy backend — set all secrets in Railway dashboard
cd apps/backend
# Set DATABASE_URL, OPENAI_API_KEY, OPENAI_BASE_URL, RAZORPAY_*, etc. in Railway
# Connect repo → Railway auto-deploys on main branch push
# Note the deployed URL: https://yomi-backend.up.railway.app

# 2. Deploy landing — set backend URL first
cd apps/landing
wrangler pages env put BACKEND_URL             --env production
wrangler pages env put NEXT_PUBLIC_BACKEND_URL --env production
bun run deploy

# 3. Update BETTER_AUTH_URL in backend to the Pages URL
```

## Files to change

- `apps/landing/package.json` — add `@opennextjs/cloudflare` and `wrangler` devDeps, update build/deploy scripts
- `.gitignore` — add `apps/landing/.open-next`

## Files to create

- `apps/landing/open-next.config.ts` — OpenNext config
- `apps/landing/wrangler.json` — Pages config

## Open questions

- **Custom domains**: `api.yomi.app` → backend, `yomi.app` → Pages — DNS config done in Cloudflare dashboard after first deploy.
- **Service Binding**: The landing's `/api/waitlist` route currently HTTP-fetches the backend. Could be replaced with a Cloudflare Service Binding for zero-latency calls. Left as a future optimization.
- **Backend hosting**: Railway vs Fly.io vs bare VPS. Railway is simplest for Bun — just set `bun run src/index.ts` as the start command.
