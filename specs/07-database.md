# Spec 07 — Database

## Purpose

Define the full Drizzle schema, migration strategy, indexes, and encryption-at-rest notes. Auth tables are owned by Better Auth; this spec covers the app-layer tables only.

## Invariants

- `usage_events` is append-only. Never update or delete rows.
- `mcp_connections.oauth_tokens` must be encrypted at rest before insert.
- PII in `hook_logs` must be redacted before insert (no raw screen content, no message bodies).
- All money values are stored in integer cents (no floats).

## Detailed Design

### Better Auth Tables (auto-generated, do not modify)

```
user             id, email, emailVerified, name, image, createdAt, updatedAt
session          id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId
account          id, accountId, providerId, userId, accessToken, refreshToken, ...
verification     id, identifier, value, expiresAt, createdAt, updatedAt
organization     id, name, slug, logo, createdAt, metadata
member           id, organizationId, userId, role, createdAt
invitation       id, organizationId, email, role, status, expiresAt, inviterId
```

### App Tables

```typescript
// packages/db/src/schema.ts

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  os: text("os").notNull(),                     // "macos" | "windows" | "linux"
  appVersion: text("app_version").notNull(),
  lastSeen: timestamp("last_seen").notNull().defaultNow(),
})

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripeSubId: text("stripe_sub_id"),           // null = free tier
  plan: text("plan").notNull().default("free"), // "free" | "pro" | "max" | "team"
  status: text("status").notNull().default("active"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  deviceId: uuid("device_id").references(() => devices.id),
  kind: text("kind").notNull(),   // "stt" | "fast_query" | "agent_run" | "tts" | "llm_stream"
  model: text("model"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costCents: integer("cost_cents").notNull().default(0),
  status: text("status").notNull().default("done"), // "started" | "done" | "error"
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  deviceId: uuid("device_id").references(() => devices.id),
  status: text("status").notNull(),  // "running" | "done" | "failed" | "cancelled"
  task: text("task").notNull(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  stepsCount: integer("steps_count").notNull().default(0),
  tokensUsed: integer("tokens_used").notNull().default(0),
  summary: text("summary"),
})

export const memoryBlobs = pgTable("memory_blobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  path: text("path").notNull(),         // relative path within ~/.yomi/
  contentHash: text("content_hash").notNull(),  // sha256 of plaintext content
  sizeBytes: integer("size_bytes").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Actual content is stored in blob storage (e.g., R2 or S3), not this table
}, (t) => ({ userPathUnique: unique().on(t.userId, t.path) }))

export const mcpConnections = pgTable("mcp_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  provider: text("provider").notNull(),   // "google" | "notion" | "slack" | etc.
  oauthTokens: text("oauth_tokens").notNull(), // AES-256-GCM encrypted JSON
  scopes: text("scopes").array().notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({ userProviderUnique: unique().on(t.userId, t.provider) }))

export const hookLogs = pgTable("hook_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  agentRunId: uuid("agent_run_id").references(() => agentRuns.id),
  hook: text("hook").notNull(),      // "preToolUse" | "postToolUse" | "stop" | "sessionEnd"
  tool: text("tool"),
  decision: text("decision"),        // "allow" | "deny" | "trim"
  payloadRedacted: jsonb("payload_redacted"),  // sanitised — no PII, no screen content
  createdAt: timestamp("created_at").notNull().defaultNow(),
})
```

### Indexes

```typescript
// High-frequency read paths
pgIndex on usage_events(user_id, created_at DESC)  // usage this period
pgIndex on usage_events(user_id, kind, created_at) // per-kind usage
pgIndex on agent_runs(user_id, status)             // active runs
pgIndex on hook_logs(agent_run_id)                 // run audit trail
pgIndex on memory_blobs(user_id, path)             // sync lookup
```

### Encryption for `mcp_connections.oauth_tokens`

Use AES-256-GCM with a key derived from `ENCRYPTION_KEY` env var (32-byte hex, never stored in DB).

```typescript
// packages/db/src/crypto.ts
export function encryptTokens(tokens: object): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv)
  const ct = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, ct, tag].map(b => b.toString("base64")).join(".")
}
```

### Migration Strategy

1. `drizzle-kit generate` → SQL files in `packages/db/drizzle/`
2. Review SQL diff before applying (`/db-migrate` command)
3. `drizzle-kit migrate` → apply to Neon
4. Never use `drizzle-kit push` on production (bypasses migration history)
5. `usage_events` is append-only — never add `DROP COLUMN` or `ALTER COLUMN` to it

## Files to change

- `packages/db/src/schema.ts` — Full Drizzle schema (all app tables + indexes)

## Files to create

- `packages/db/src/crypto.ts` — AES-256-GCM encryption for oauth_tokens
- `packages/db/src/index.ts` — Re-exports for the rest of the monorepo

## Open Questions

- Blob storage for `memory_blobs` content: Cloudflare R2 (cheap, fast, S3-compatible) or Vercel Blob. Decide at Phase 3.
- `ENCRYPTION_KEY` rotation strategy: needs a migration plan before launch.
