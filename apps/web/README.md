# Yomi web app

The Next.js app at [getyomi.in](https://getyomi.in): the marketing site,
sign-in, user docs, and the management dashboard. It deploys to Cloudflare
Workers as `yomi-landing`.

The app holds no data of its own. Every `/api/*` request is rewritten to the
FastAPI backend (`BACKEND_URL`, default `http://localhost:3001`; set it to
`http://localhost:8080` for local development). See [`CLAUDE.md`](./CLAUDE.md)
for the Workers I/O rules this code must follow.

## Layout

```text
src/
├── app/            Routes: landing, pricing, docs, signin/signup, dashboard, legal pages
├── components/
│   ├── dashboard/  Dashboard shell and views (home, skills, routines, memory, vault, ...)
│   ├── auth/       Telegram, Google, and GitHub sign-in
│   └── landing/    Marketing sections
├── lib/            API client, auth client, helpers
└── worker.ts       Cloudflare Worker entry
scripts/            Asset preparation and post-deploy smoke test
```

## Development

```bash
# From the repository root
npm install
cp apps/web/.env.example apps/web/.env.local
npm run dev --workspace @yomi/web
```

The app runs on http://localhost:3000 and expects the backend on port 8080.

## Scripts

| Command                               | Purpose                                  |
| ------------------------------------- | ---------------------------------------- |
| `npm run dev`                         | Development server on port 3000          |
| `npm run build`                       | Production Next.js build                 |
| `npm run lint` / `typecheck` / `test` | ESLint, `tsc`, Vitest                    |
| `npm run preview:cloudflare`          | Run the production Worker locally        |
| `npm run deploy:staging`              | Build and deploy to staging              |
| `npm run deploy:production`           | Build, deploy, and smoke-test production |

Pushes to `main` that touch `apps/web/**` deploy automatically through
`.github/workflows/deploy-landing.yml`. `NEXT_PUBLIC_*` values are baked in at
build time.
