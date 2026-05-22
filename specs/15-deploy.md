# Spec 15 — Deploy

## Purpose

Deploy `apps/backend` to Cloudflare Workers and `apps/landing` to Cloudflare Pages, replacing the
Vercel + bare-Bun targets mentioned in earlier specs. Both apps run on Cloudflare's edge network.
The backend uses Hono's native Workers handler. The landing uses `@opennextjs/cloudflare` (OpenNext)
to adapt Next.js 16 for the Workers runtime.

## Invariants

- API keys and secrets live only in Cloudflare Worker secrets / Pages env variables — never committed.
- `@neondatabase/serverless` with `drizzle-orm/neon-http` is already Workers-compatible (HTTP, not TCP). No changes to the DB client.
- `nodejs_compat` compatibility flag is required on the backend Worker (Better Auth + Stripe webhook verification use Node.js crypto).
- Binary downloads never served from Workers/Pages — always GitHub Releases.
- `main` branch = production for both apps.

## Detailed Design

### Backend — Cloudflare Workers

Hono already exports `app.fetch`, which matches the Workers `fetch` handler signature exactly.
Two things need to change in code; everything else is config.

#### Code changes

**`src/index.ts`** — remove the Bun-specific `port` field:
```typescript
// remove:  port: PORT,
export default { fetch: app.fetch }
```

**`src/routes/billing.ts`** — two Stripe / Workers fixes:
```typescript
// 1. Use fetch-based HTTP client (Workers have no XMLHttpRequest)
const stripe = new Stripe(process.env["STRIPE_SECRET_KEY"]!, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
})

// 2. Use async webhook construction (Web Crypto, not Node sync crypto)
event = await stripe.webhooks.constructEventAsync(
  await c.req.text(),
  sig,
  process.env["STRIPE_WEBHOOK_SECRET"]!,
)
```

#### Config

**`wrangler.toml`**:
```toml
name = "yomi-backend"
main = "src/index.ts"
compatibility_date = "2025-05-01"
compatibility_flags = ["nodejs_compat"]

[vars]
BETTER_AUTH_URL = "https://yomi-landing.pages.dev"
STRIPE_PRO_PRICE_ID  = ""   # fill after Stripe products created
STRIPE_MAX_PRICE_ID  = ""
STRIPE_TEAM_PRICE_ID = ""

# Secrets — set via `wrangler secret put <NAME>`:
# DATABASE_URL
# GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
# GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
# BETTER_AUTH_SECRET
# STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
# ANTHROPIC_API_KEY
# ELEVENLABS_API_KEY
# OPENROUTER_API_KEY   (optional)
# LLM_BASE_URL         (optional)
```

**`.dev.vars`** (gitignored) — secrets for `wrangler dev`:
```
DATABASE_URL=postgres://...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
BETTER_AUTH_SECRET=...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
ANTHROPIC_API_KEY=sk-ant-...
ELEVENLABS_API_KEY=...
```

**`package.json` scripts**:
```json
"dev":    "wrangler dev --port 3001",
"deploy": "wrangler deploy",
"build":  "wrangler deploy --dry-run --outdir dist"
```

---

### Landing — Cloudflare Pages + OpenNext

`@opennextjs/cloudflare` compiles Next.js output into a Worker that Pages can serve. It reads the
standard `next.config.mjs` — no changes needed there.

**`open-next.config.ts`**:
```typescript
import type { OpenNextConfig } from "@opennextjs/cloudflare"
const config: OpenNextConfig = {}
export default config
```

**`wrangler.json`** (Pages uses JSON not TOML):
```json
{
  "name": "yomi-landing",
  "compatibility_date": "2025-05-01",
  "compatibility_flags": ["nodejs_compat"],
  "pages_build_output_dir": ".open-next/assets"
}
```

**`package.json` scripts**:
```json
"build":   "opennextjs-cloudflare build",
"deploy":  "opennextjs-cloudflare build && wrangler pages deploy",
"preview": "wrangler pages dev .open-next/assets"
```

**Environment variables** (Pages dashboard → Settings → Environment variables):
```
BACKEND_URL             = https://yomi-backend.workers.dev
NEXT_PUBLIC_BACKEND_URL = https://yomi-backend.workers.dev
```

---

### Environment variable reference

| Variable | Backend | Landing | Secret? |
|---|:---:|:---:|:---:|
| `DATABASE_URL` | ✓ | — | yes |
| `GOOGLE_CLIENT_ID` | ✓ | — | yes |
| `GOOGLE_CLIENT_SECRET` | ✓ | — | yes |
| `GITHUB_CLIENT_ID` | ✓ | — | yes |
| `GITHUB_CLIENT_SECRET` | ✓ | — | yes |
| `BETTER_AUTH_SECRET` | ✓ | — | yes |
| `BETTER_AUTH_URL` | ✓ | — | no (var) |
| `STRIPE_SECRET_KEY` | ✓ | — | yes |
| `STRIPE_WEBHOOK_SECRET` | ✓ | — | yes |
| `STRIPE_PRO_PRICE_ID` | ✓ | — | no (var) |
| `STRIPE_MAX_PRICE_ID` | ✓ | — | no (var) |
| `STRIPE_TEAM_PRICE_ID` | ✓ | — | no (var) |
| `ANTHROPIC_API_KEY` | ✓ | — | yes |
| `ELEVENLABS_API_KEY` | ✓ | — | yes |
| `OPENROUTER_API_KEY` | ✓ | — | yes (optional) |
| `LLM_BASE_URL` | ✓ | — | no, optional |
| `BACKEND_URL` | — | ✓ | no (var) |
| `NEXT_PUBLIC_BACKEND_URL` | — | ✓ | no (var) |

---

### Local development

```bash
# Backend: wrangler dev reads .dev.vars automatically
cd apps/backend && bun run dev   # :3001

# Landing: still uses next dev (faster DX; opennextjs only needed for deploy)
cd apps/landing
echo "BACKEND_URL=http://localhost:3001" >> .env.local
bun run dev   # :3000
```

### Deployment sequence

```bash
# 1. Deploy backend first — landing will need its URL
cd apps/backend
wrangler secret put DATABASE_URL        # paste value when prompted
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put ELEVENLABS_API_KEY
wrangler deploy
# note the deployed URL: https://yomi-backend.<account>.workers.dev

# 2. Deploy landing — set backend URL first
cd apps/landing
wrangler pages env put BACKEND_URL             --env production
wrangler pages env put NEXT_PUBLIC_BACKEND_URL --env production
bun run deploy

# 3. Point CORS: update BETTER_AUTH_URL in wrangler.toml [vars] to the
#    Pages URL, then redeploy backend.
wrangler deploy
```

## Files to change

- `apps/backend/src/index.ts` — remove `port` from the default export
- `apps/backend/src/routes/billing.ts` — `httpClient: Stripe.createFetchHttpClient()` + `constructEventAsync`
- `apps/backend/package.json` — add `wrangler` to devDeps, update scripts
- `apps/landing/package.json` — add `@opennextjs/cloudflare` and `wrangler` to devDeps, update scripts
- `.gitignore` — add `apps/backend/.dev.vars` and `apps/landing/.open-next`

## Files to create

- `apps/backend/wrangler.toml` — Worker config (name, compat flags, vars)
- `apps/backend/.dev.vars.example` — template for local secrets (committed, no real values)
- `apps/landing/open-next.config.ts` — OpenNext config
- `apps/landing/wrangler.json` — Pages config

## Open questions

- **Custom domains**: `api.yomi.app` → backend Worker, `yomi.app` → Pages — DNS config done in Cloudflare dashboard after first deploy. Not codified here.
- **Automatic Git deploys**: Cloudflare Pages can auto-deploy from `main`. Enable in Pages dashboard after the first manual deploy. GitHub Actions not needed unless you want pre-deploy tests.
- **Service Binding**: The landing's `/api/waitlist` route currently HTTP-fetches the backend. Could be replaced with a Cloudflare Service Binding for zero-latency calls. Left as a future optimization since HTTP works fine.
- **D1 vs Neon**: Could migrate to Cloudflare D1 for tighter integration. Not worth it — Neon over HTTP is production-grade and already wired up.
