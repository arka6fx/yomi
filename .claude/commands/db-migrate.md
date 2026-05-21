---
description: Run a safe Drizzle migration
---
Run a safe Drizzle migration.

Steps:
1. Run `cd packages/db && bun run db:generate` to generate the migration SQL.
2. Show the generated SQL diff (read the latest file in `packages/db/drizzle/`).
3. Ask the user to confirm before applying.
4. On confirmation, run `cd packages/db && bun run db:migrate`.
5. Verify by running `cd packages/db && bun run db:studio` and describing the current schema state.

Safety rules:
- Never run `db:push` on production (it bypasses migration history).
- If the migration drops a column, flag it explicitly before confirming.
- `usage_events` is append-only — never add a destructive migration to it.
