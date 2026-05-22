import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

// --- Better Auth tables (auto-generated, stub for FK references only) ---

// Mirrors Better Auth's `user` table — configured with UUID PKs in apps/backend
export const users = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

// --- App tables ---

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  os: text("os").notNull(),           // "macos" | "windows"
  appVersion: text("app_version").notNull(),
  lastSeen: timestamp("last_seen").notNull().defaultNow(),
})

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  razorpayCustomerId: text("razorpay_customer_id").notNull().default(""),
  razorpaySubId: text("razorpay_sub_id"),
  plan: text("plan").notNull().default("free"),   // "free" | "basic" | "standard" | "genesis"
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
  kind: text("kind").notNull(), // "stt" | "fast_query" | "agent_run" | "tts" | "llm_stream"
  model: text("model"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costCents: integer("cost_cents").notNull().default(0), // integer cents, never floats
  status: text("status").notNull().default("done"),      // "started" | "done" | "error"
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  userPeriodIdx: index("usage_events_user_period_idx").on(t.userId, t.createdAt),
  userKindIdx: index("usage_events_user_kind_idx").on(t.userId, t.kind, t.createdAt),
}))

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  deviceId: uuid("device_id").references(() => devices.id),
  status: text("status").notNull(), // "running" | "done" | "failed" | "cancelled"
  task: text("task").notNull(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  stepsCount: integer("steps_count").notNull().default(0),
  tokensUsed: integer("tokens_used").notNull().default(0),
  summary: text("summary"),
}, (t) => ({
  userStatusIdx: index("agent_runs_user_status_idx").on(t.userId, t.status),
}))

export const memoryBlobs = pgTable("memory_blobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  path: text("path").notNull(),              // relative path within ~/.yomi/
  contentHash: text("content_hash").notNull(), // sha256 of plaintext content
  sizeBytes: integer("size_bytes").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Actual content in blob storage (R2 or S3), not this table
}, (t) => ({
  userPathUnique: unique("memory_blobs_user_path_unique").on(t.userId, t.path),
  userPathIdx: index("memory_blobs_user_path_idx").on(t.userId, t.path),
}))

export const mcpConnections = pgTable("mcp_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  provider: text("provider").notNull(), // "google" | "notion" | "slack" | etc.
  oauthTokens: text("oauth_tokens").notNull(), // AES-256-GCM encrypted JSON
  scopes: text("scopes").array().notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  userProviderUnique: unique("mcp_connections_user_provider_unique").on(t.userId, t.provider),
}))

export const hookLogs = pgTable("hook_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  agentRunId: uuid("agent_run_id").references(() => agentRuns.id),
  hook: text("hook").notNull(),     // "preToolUse" | "postToolUse" | "stop" | "sessionEnd"
  tool: text("tool"),
  decision: text("decision"),       // "allow" | "deny" | "trim"
  payloadRedacted: jsonb("payload_redacted"), // sanitised — no PII, no screen content
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  agentRunIdx: index("hook_logs_agent_run_idx").on(t.agentRunId),
}))
