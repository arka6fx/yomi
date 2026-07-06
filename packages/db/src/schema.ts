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
  deletedAt: timestamp("deleted_at"),
  privacyPreferences: jsonb("privacy_preferences").notNull().default({}),
  consentVersion: text("consent_version"),
  consentTimestamp: timestamp("consent_timestamp"),
  privacyPolicyVersion: text("privacy_policy_version"),
  termsVersion: text("terms_version"),
  lastExportAt: timestamp("last_export_at"),
  exportCount: integer("export_count").notNull().default(0),
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

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    kind: text("kind").notNull(), // "stt" | "fast_query" | "agent_run" | "tts" | "llm_stream"
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0), // integer cents, never floats
    creditsCharged: integer("credits_charged").notNull().default(0),
    status: text("status").notNull().default("done"), // "started" | "done" | "error"
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userPeriodIdx: index("usage_events_user_period_idx").on(t.userId, t.createdAt),
    userKindIdx: index("usage_events_user_kind_idx").on(t.userId, t.kind, t.createdAt),
  }),
)

export const creditAccounts = pgTable("credit_accounts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  availableCredits: integer("available_credits").notNull().default(0),
  lifetimeGranted: integer("lifetime_granted").notNull().default(0),
  lifetimeConsumed: integer("lifetime_consumed").notNull().default(0),
  lifetimeRefunded: integer("lifetime_refunded").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const paymentRecords = pgTable(
  "payment_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    kind: text("kind").notNull(), // "subscription" | "credit_pack"
    productKey: text("product_key").notNull(),
    providerCustomerId: text("provider_customer_id"),
    providerOrderId: text("provider_order_id"),
    providerPaymentId: text("provider_payment_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    amountCents: integer("amount_cents").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("created"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("payment_records_user_idx").on(t.userId, t.createdAt),
    providerPaymentUnique: unique("payment_records_provider_payment_unique").on(
      t.provider,
      t.providerPaymentId,
    ),
    providerOrderUnique: unique("payment_records_provider_order_unique").on(
      t.provider,
      t.providerOrderId,
    ),
  }),
)

export const creditGrants = pgTable(
  "credit_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id").references(() => paymentRecords.id),
    source: text("source").notNull(), // "subscription_cycle" | "credit_pack" | "admin_adjustment" | "refund" | "migration" | "promo"
    sourceId: text("source_id").notNull(),
    creditsGranted: integer("credits_granted").notNull(),
    creditsRemaining: integer("credits_remaining").notNull(),
    expiresAt: timestamp("expires_at"),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userStatusIdx: index("credit_grants_user_status_idx").on(t.userId, t.status, t.expiresAt),
    sourceUnique: unique("credit_grants_source_unique").on(t.source, t.sourceId),
  }),
)

export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    grantId: uuid("grant_id").references(() => creditGrants.id),
    usageEventId: uuid("usage_event_id").references(() => usageEvents.id, { onDelete: "set null" }),
    paymentId: uuid("payment_id").references(() => paymentRecords.id),
    type: text("type").notNull(), // "grant" | "reserve" | "consume" | "release" | "refund" | "adjustment" | "expire"
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    reason: text("reason"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userCreatedIdx: index("credit_transactions_user_created_idx").on(t.userId, t.createdAt),
    idempotencyUnique: unique("credit_transactions_idempotency_unique").on(t.idempotencyKey),
  }),
)

export const processedPaymentEvents = pgTable(
  "processed_payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadHash: text("payload_hash").notNull(),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
  },
  (t) => ({
    providerEventUnique: unique("processed_payment_events_provider_event_unique").on(
      t.provider,
      t.eventId,
    ),
  }),
)

export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    chatId: text("chat_id").notNull(),
    title: text("title"),
    summary: text("summary"),
    status: text("status").notNull().default("active"),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
    closedAt: timestamp("closed_at"),
  },
  (t) => ({
    userPlatformIdx: index("agent_sessions_user_platform_idx").on(t.userId, t.platform, t.chatId),
    userStatusIdx: index("agent_sessions_user_status_idx").on(t.userId, t.status, t.lastMessageAt),
  }),
)

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => agentSessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    sessionCreatedIdx: index("agent_messages_session_created_idx").on(t.sessionId, t.createdAt),
    userCreatedIdx: index("agent_messages_user_created_idx").on(t.userId, t.createdAt),
  }),
)

// Cloud-managed scheduled jobs. Created/edited from the dashboard, executed by the
// backend Worker's cron trigger so they run even when the desktop is closed.
export const schedules = pgTable(
  "schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    schedule: text("schedule").notNull(), // raw input, e.g. "every day 9am"
    scheduleType: text("schedule_type").notNull(), // duration | phrase | cron | iso
    prompt: text("prompt").notNull(),
    deliverTo: jsonb("deliver_to"), // string[] of delivery targets (e.g. ["telegram"])
    enabled: boolean("enabled").notNull().default(true),
    oneShot: boolean("one_shot").notNull().default(false),
    nextRunAt: timestamp("next_run_at"), // null when not schedulable / disabled
    lastRunAt: timestamp("last_run_at"),
    lastRunStatus: text("last_run_status"), // success | error
    lastRunError: text("last_run_error"),
    runCount: integer("run_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("schedules_user_idx").on(t.userId),
    dueIdx: index("schedules_due_idx").on(t.enabled, t.nextRunAt),
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
    syncState: jsonb("sync_state"),
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
    externalId: text("external_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("rag_documents_user_idx").on(t.userId),
    sourceIdx: index("rag_documents_source_idx").on(t.sourceId),
    sourceHashUnique: unique("rag_documents_source_hash_unique").on(t.sourceId, t.contentHash),
    sourceExternalIdx: index("rag_documents_source_external_idx").on(t.sourceId, t.externalId),
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

export const memoryEntries = pgTable(
  "memory_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    customId: text("custom_id"),
    contentHash: text("content_hash").notNull(),
    kind: text("kind").notNull().default("fact"),
    scope: text("scope").notNull().default("global"),
    topic: text("topic").notNull(),
    summary: text("summary"),
    content: text("content").notNull(),
    status: text("status").notNull().default("active"),
    confidence: integer("confidence").notNull().default(70),
    sourceType: text("source_type"),
    sourcePath: text("source_path"),
    version: integer("version").notNull().default(1),
    isLatest: boolean("is_latest").notNull().default(true),
    isStatic: boolean("is_static").notNull().default(false),
    rootMemoryId: uuid("root_memory_id"),
    parentMemoryId: uuid("parent_memory_id"),
    forgetAfter: timestamp("forget_after"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userStatusIdx: index("memory_entries_user_status_idx").on(t.userId, t.status, t.updatedAt),
    userTopicIdx: index("memory_entries_user_topic_idx").on(t.userId, t.topic),
    userCustomUnique: unique("memory_entries_user_custom_unique").on(t.userId, t.customId),
    userHashIdx: index("memory_entries_user_hash_idx").on(t.userId, t.contentHash),
  }),
)

export const memorySources = pgTable(
  "memory_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memoryEntries.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => ragDocuments.id, { onDelete: "set null" }),
    chunkId: uuid("chunk_id").references(() => ragChunks.id, { onDelete: "set null" }),
    sourcePath: text("source_path"),
    relevance: integer("relevance").notNull().default(100),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    memoryIdx: index("memory_sources_memory_idx").on(t.memoryId),
  }),
)

export const memoryRelations = pgTable(
  "memory_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    fromMemoryId: uuid("from_memory_id")
      .notNull()
      .references(() => memoryEntries.id, { onDelete: "cascade" }),
    toMemoryId: uuid("to_memory_id")
      .notNull()
      .references(() => memoryEntries.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userFromIdx: index("memory_relations_user_from_idx").on(t.userId, t.fromMemoryId),
    relationUnique: unique("memory_relations_unique").on(
      t.fromMemoryId,
      t.toMemoryId,
      t.relationType,
    ),
  }),
)

export const memoryEmbeddings = pgTable(
  "memory_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memoryEntries.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    embedding: vector("embedding").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("memory_embeddings_user_idx").on(t.userId),
    memoryIdx: index("memory_embeddings_memory_idx").on(t.memoryId),
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
    displayName: text("display_name"),
    expiresAt: timestamp("expires_at"),
    lastSyncAt: timestamp("last_sync_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userProviderUnique: unique("mcp_connections_user_provider_unique").on(t.userId, t.provider),
  }),
)

export const platformConnections = pgTable(
  "platform_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    platformUserId: text("platform_user_id").notNull(),
    platformChatId: text("platform_chat_id"),
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

export const pendingActions = pgTable(
  "pending_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connector: text("connector").notNull(),
    action: text("action").notNull(),
    risk: text("risk").notNull(),
    title: text("title").notNull(),
    preview: text("preview").notNull(),
    confirmText: text("confirm_text"),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    result: jsonb("result"),
    sourcePlatform: text("source_platform"),
    sourceChatId: text("source_chat_id"),
    requestedByRunId: uuid("requested_by_run_id"), // optional agent-run correlation id (no FK)
    expiresAt: timestamp("expires_at").notNull(),
    decidedAt: timestamp("decided_at"),
    executedAt: timestamp("executed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userStatusIdx: index("pending_actions_user_status_idx").on(t.userId, t.status, t.createdAt),
    expiresIdx: index("pending_actions_expires_idx").on(t.status, t.expiresAt),
    connectorActionIdx: index("pending_actions_connector_action_idx").on(t.connector, t.action),
  }),
)

export const linkingCodes = pgTable("linking_codes", {
  code: text("code").primaryKey().notNull(),
  platform: text("platform").notNull(),
  platformUserId: text("platform_user_id").notNull(),
  platformChatId: text("platform_chat_id"),
  userId: text("user_id"),
  expiresAt: timestamp("expires_at").notNull(),
})

// Telegram deep-link onboarding tokens
export const telegramLinkTokens = pgTable("telegram_link_tokens", {
  token: text("token").primaryKey().notNull(),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").notNull().default(false),
  telegramUserId: text("telegram_user_id"),
})

// Device-code OAuth flow (RFC 8628) — persisted in DB so CF Worker isolates share state
export const deviceCodes = pgTable(
  "device_codes",
  {
    deviceCode: text("device_code").primaryKey().notNull(),
    userCode: text("user_code").notNull(),
    clientId: text("client_id").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token"), // null until confirmed by browser
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userCodeIdx: index("device_codes_user_code_idx").on(t.userCode),
    expiresAtIdx: index("device_codes_expires_at_idx").on(t.expiresAt),
  }),
)

export const privacyConsents = pgTable(
  "privacy_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    purpose: text("purpose").notNull(),
    status: text("status").notNull(),
    consentVersion: text("consent_version").notNull(),
    privacyPolicyVersion: text("privacy_policy_version").notNull(),
    termsVersion: text("terms_version").notNull(),
    appVersion: text("app_version"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userPurposeIdx: index("privacy_consents_user_purpose_idx").on(t.userId, t.purpose, t.createdAt),
    userStatusIdx: index("privacy_consents_user_status_idx").on(t.userId, t.status),
  }),
)

export const privacyPreferences = pgTable("privacy_preferences", {
  userId: text("user_id").primaryKey().notNull(),
  conversationHistoryEnabled: boolean("conversation_history_enabled").notNull().default(false),
  memoryEnabled: boolean("memory_enabled").notNull().default(false),
  cloudMemoryEnabled: boolean("cloud_memory_enabled").notNull().default(false),
  connectorsEnabled: boolean("connectors_enabled").notNull().default(false),
  analyticsEnabled: boolean("analytics_enabled").notNull().default(false),
  voiceProcessingEnabled: boolean("voice_processing_enabled").notNull().default(false),
  screenProcessingEnabled: boolean("screen_processing_enabled").notNull().default(false),
  aiImprovementEnabled: boolean("ai_improvement_enabled").notNull().default(false),
  retentionOverrides: jsonb("retention_overrides"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const privacyExports = pgTable(
  "privacy_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    status: text("status").notNull().default("queued"),
    format: text("format").notNull().default("json"),
    manifest: jsonb("manifest"),
    archiveUrl: text("archive_url"),
    archiveSha256: text("archive_sha256"),
    error: text("error"),
    requestedAt: timestamp("requested_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
    expiresAt: timestamp("expires_at"),
  },
  (t) => ({
    userStatusIdx: index("privacy_exports_user_status_idx").on(t.userId, t.status, t.requestedAt),
  }),
)

export const privacyDeletionJobs = pgTable(
  "privacy_deletion_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("queued"),
    steps: jsonb("steps").notNull().default([]),
    error: text("error"),
    requestedAt: timestamp("requested_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => ({
    userStatusIdx: index("privacy_deletion_jobs_user_status_idx").on(
      t.userId,
      t.status,
      t.requestedAt,
    ),
  }),
)

export const privacyAuditEvents = pgTable(
  "privacy_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: text("actor_user_id"),
    targetUserId: text("target_user_id"),
    eventType: text("event_type").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    targetCreatedIdx: index("privacy_audit_events_target_created_idx").on(
      t.targetUserId,
      t.createdAt,
    ),
    actorCreatedIdx: index("privacy_audit_events_actor_created_idx").on(t.actorUserId, t.createdAt),
    eventTypeIdx: index("privacy_audit_events_type_idx").on(t.eventType, t.createdAt),
  }),
)

// Rich per-request AI telemetry. Additive companion to usage_events — never
// billing-critical. request_id gives idempotency for retried finalizations.
export const aiUsageEvents = pgTable(
  "ai_usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usageEventId: uuid("usage_event_id").references(() => usageEvents.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    endpoint: text("endpoint").notNull(), // "sidecar.fast" | "sidecar.agent" | "backend.agent" | "gateway.image" | "gateway.voice"
    surface: text("surface").notNull(), // "desktop" | "telegram" | "dashboard" | "cron" | "backend"
    route: text("route"), // "fast" | "agent" | "gateway"
    intent: text("intent"),
    complexity: text("complexity"),
    model: text("model"),
    provider: text("provider"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    embeddingTokens: integer("embedding_tokens").notNull().default(0),
    maxOutputTokens: integer("max_output_tokens").notNull().default(0),
    toolCalls: integer("tool_calls").notNull().default(0),
    connectorCount: integer("connector_count").notNull().default(0),
    connectorIds: text("connector_ids").array().notNull().default([]),
    visionImages: integer("vision_images").notNull().default(0),
    voiceDurationSeconds: integer("voice_duration_seconds").notNull().default(0),
    ttsChars: integer("tts_chars").notNull().default(0),
    sttAudioSeconds: integer("stt_audio_seconds").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    firstTokenLatencyMs: integer("first_token_latency_ms"),
    totalApiCostMicros: integer("total_api_cost_micros").notNull().default(0),
    creditPolicyVersion: text("credit_policy_version").notNull().default("static-v1"),
    creditsEstimated: integer("credits_estimated").notNull().default(0),
    creditsCharged: integer("credits_charged").notNull().default(0),
    status: text("status").notNull().default("started"), // "started" | "done" | "error" | "cancelled"
    errorCode: text("error_code"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => ({
    requestIdUq: unique("ai_usage_events_request_id_uq").on(t.requestId),
    userCreatedIdx: index("ai_usage_events_user_created_idx").on(t.userId, t.createdAt),
    endpointIdx: index("ai_usage_events_endpoint_idx").on(t.endpoint, t.createdAt),
    modelIdx: index("ai_usage_events_model_idx").on(t.model, t.createdAt),
    statusIdx: index("ai_usage_events_status_idx").on(t.status),
    usageEventIdx: index("ai_usage_events_usage_event_idx").on(t.usageEventId),
  }),
)
