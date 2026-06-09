import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  customType,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)"
  },
  toDriver(value: number[]) {
    return `[${value.join(",")}]`
  },
})

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
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  os: text("os").notNull(), // "windows"
  appVersion: text("app_version").notNull(),
  sidecarUrl: text("sidecar_url"), // URL of the user's sidecar for message routing
  lastSeen: timestamp("last_seen").notNull().defaultNow(),
})

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  razorpayCustomerId: text("razorpay_customer_id").notNull().default(""),
  razorpaySubId: text("razorpay_sub_id"),
  plan: text("plan").notNull().default("explore"), // "explore" | "pro" | "max"
  status: text("status").notNull().default("active"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    deviceId: uuid("device_id").references(() => devices.id),
    kind: text("kind").notNull(), // "stt" | "fast_query" | "agent_run" | "tts" | "llm_stream"
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0), // integer cents, never floats
    status: text("status").notNull().default("done"), // "started" | "done" | "error"
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userPeriodIdx: index("usage_events_user_period_idx").on(t.userId, t.createdAt),
    userKindIdx: index("usage_events_user_kind_idx").on(t.userId, t.kind, t.createdAt),
  }),
)

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    deviceId: uuid("device_id").references(() => devices.id),
    status: text("status").notNull(), // "running" | "done" | "failed" | "cancelled"
    task: text("task").notNull(),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    endedAt: timestamp("ended_at"),
    stepsCount: integer("steps_count").notNull().default(0),
    tokensUsed: integer("tokens_used").notNull().default(0),
    summary: text("summary"),
  },
  (t) => ({
    userStatusIdx: index("agent_runs_user_status_idx").on(t.userId, t.status),
  }),
)

export const memoryBlobs = pgTable(
  "memory_blobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    path: text("path").notNull(), // relative path within ~/.yomi/
    contentHash: text("content_hash").notNull(), // sha256 of plaintext content
    sizeBytes: integer("size_bytes").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    // Actual content in blob storage (R2 or S3), not this table
  },
  (t) => ({
    userPathUnique: unique("memory_blobs_user_path_unique").on(t.userId, t.path),
    userPathIdx: index("memory_blobs_user_path_idx").on(t.userId, t.path),
  }),
)

export const ragSources = pgTable(
  "rag_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    path: text("path"),
    contentHash: text("content_hash"),
    sourceType: text("source_type").notNull(), // "upload" | "url" | "folder" | "manual"
    privacyScope: text("privacy_scope").notNull().default("cloud_rag"),
    status: text("status").notNull().default("indexing"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("rag_sources_user_idx").on(t.userId),
    userPathUnique: unique("rag_sources_user_path_unique").on(t.userId, t.path),
  }),
)

export const ragDocuments = pgTable(
  "rag_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => ragSources.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    mimeType: text("mime_type").notNull().default("text/plain"),
    contentHash: text("content_hash").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("rag_documents_user_idx").on(t.userId),
    sourceIdx: index("rag_documents_source_idx").on(t.sourceId),
    sourceHashUnique: unique("rag_documents_source_hash_unique").on(t.sourceId, t.contentHash),
  }),
)

export const ragChunks = pgTable(
  "rag_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => ragDocuments.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    // content_tsv (generated tsvector) + its GIN index live in migration 0006_rag_hybrid.sql,
    // mirroring how the HNSW vector index is migration-only. Hybrid search references it via raw SQL.
    tokenCount: integer("token_count").notNull().default(0),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("rag_chunks_user_idx").on(t.userId),
    documentIdx: index("rag_chunks_document_idx").on(t.documentId),
  }),
)

export const ragEmbeddings = pgTable(
  "rag_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => ragChunks.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    embedding: vector("embedding").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("rag_embeddings_user_idx").on(t.userId),
    chunkIdx: index("rag_embeddings_chunk_idx").on(t.chunkId),
  }),
)

export const ragRetrievalLogs = pgTable(
  "rag_retrieval_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    queryHash: text("query_hash").notNull(),
    matchedChunkIds: text("matched_chunk_ids").array().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("rag_retrieval_logs_user_idx").on(t.userId, t.createdAt),
  }),
)

export const mcpConnections = pgTable(
  "mcp_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(), // "google" | "notion" | "slack" | etc.
    oauthTokens: text("oauth_tokens").notNull(), // AES-256-GCM encrypted JSON
    scopes: text("scopes").array().notNull(),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userProviderUnique: unique("mcp_connections_user_provider_unique").on(t.userId, t.provider),
  }),
)

export const hookLogs = pgTable(
  "hook_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id),
    hook: text("hook").notNull(), // "preToolUse" | "postToolUse" | "stop" | "sessionEnd"
    tool: text("tool"),
    decision: text("decision"), // "allow" | "deny" | "trim"
    payloadRedacted: jsonb("payload_redacted"), // sanitised — no PII, no screen content
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    agentRunIdx: index("hook_logs_agent_run_idx").on(t.agentRunId),
  }),
)

export const platformConnections = pgTable(
  "platform_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // "telegram" | "discord" | "slack" | "whatsapp"
    platformUserId: text("platform_user_id").notNull(), // user's ID on the external platform
    platformChatId: text("platform_chat_id"), // specific chat/channel if applicable
    connectedAt: timestamp("connected_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    platformUserUnique: unique("platform_connections_platform_user_unique").on(
      t.platform,
      t.platformUserId,
    ),
    userIdx: index("platform_connections_user_idx").on(t.userId),
    platformIdx: index("platform_connections_platform_idx").on(t.platform, t.platformUserId),
  }),
)
