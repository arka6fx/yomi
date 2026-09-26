# Packages

Shared code for the apps in [`apps/`](../apps).

| Package                                    | What it holds                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| [`db`](./db)                               | SQLAlchemy models for the legacy Postgres path (Python, `yomi-db`)        |
| [`shared`](./shared)                       | TypeScript contracts: plans, privacy consent, AI pricing, starter prompts |
| [`ui`](./ui)                               | Connector catalog and dashboard components, used by `apps/web`            |
| [`eslint-config`](./eslint-config)         | Shared ESLint config (base and Next.js)                                   |
| [`typescript-config`](./typescript-config) | Shared `tsconfig` presets (base and Next.js)                              |

`packages/ui/src/catalog.ts` is the source of truth for the connector catalog.
`npm run docs:check` fails if the docs drift from it.
