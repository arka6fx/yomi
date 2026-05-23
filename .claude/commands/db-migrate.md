---
description: Generate and apply a Drizzle migration safely
allowed-tools: Bash, Read, Glob
---

Run a Drizzle ORM migration against the Neon database. Always shows SQL before applying.

## 1 — Generate migration SQL

```bash
cd packages/db && bun run db:generate
```

## 2 — Show diff

Find the newest file in `packages/db/drizzle/` and read it:

```bash
ls -t packages/db/drizzle/*.sql | head -1
```

Print the full SQL. Highlight:
- Any `DROP COLUMN` or `DROP TABLE` — flag these explicitly
- Any `ALTER TABLE ... ADD COLUMN ... NOT NULL` without a default — this will fail on non-empty tables

**`usage_events` is append-only.** If the migration touches this table destructively, stop and refuse.

## 3 — Confirm

Ask: "Apply this migration to the database? (yes/no)"

Do not proceed until the user types yes.

## 4 — Apply

```bash
cd packages/db && bun run db:migrate
```

## 5 — Verify

```bash
cd packages/db && bun run db:studio
```

Describe the current schema state in one paragraph (tables present, new columns, indexes).

## Safety rules

- Never run `db:push` — it bypasses migration history
- Never apply without showing the SQL first
- If migration fails, read the error and suggest a fix — do not retry automatically
