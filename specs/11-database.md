# Spec 11 — Database

## Purpose

Define the Drizzle ORM schema, database client, and migration workflow using Neon serverless Postgres.

## Invariants

- Drizzle ORM is the sole database interface.
- All migrations are generated via `drizzle-kit` and committed to the repo.
- `DATABASE_URL` must be set in the backend environment. No database access from sidecar or desktop.
- Schema lives in `packages/db/src/schema.ts` and is importable by both `apps/backend` and `packages/db` directly.

## Detailed Design

### Tables

#### `users`

Column | Type | Notes
---|---|---
`id` | `text` (PK) | Generated ULID
`email` | `text (unique)` | User's email
`name` | `text` | Display name
`plan` | `free \| basic \| standard \| genesis` | Current subscription plan
`razorpay_customer_id` | `text (default "")` | Razorpay customer ID (empty string for free-tier)
`razorpay_sub_id` | `text (default "")` | Razorpay subscription ID
`created_at` | `timestamp (default now())` |
`updated_at` | `timestamp (default now())` |

#### `sessions`

(Sessions managed by Better Auth — schema defined via `better-auth` Drizzle adapter.)

#### `api_keys`

(API key management — future use.)

### Seeds

- No seed data needed for production.
- For development: seed a single admin user via `bun run db:seed`.

## Files to change

- `packages/db/src/schema.ts` — user table with Razorpay fields.

## Migration workflow

```bash
bun run db:generate   # drizzle-kit generate
bun run db:migrate    # drizzle-kit migrate
bun run db:studio     # drizzle-kit studio
```

## Open Questions

- None.
