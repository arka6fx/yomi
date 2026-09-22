PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "device_codes" (
  "device_code" TEXT PRIMARY KEY NOT NULL,
  "user_code" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "token" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "device_codes_expires_at_idx" ON "device_codes" ("expires_at");
CREATE INDEX IF NOT EXISTS "device_codes_user_code_idx" ON "device_codes" ("user_code");

CREATE TABLE IF NOT EXISTS "linking_codes" (
  "code" TEXT PRIMARY KEY NOT NULL,
  "platform" TEXT NOT NULL,
  "platform_user_id" TEXT NOT NULL,
  "platform_chat_id" TEXT,
  "user_id" TEXT,
  "expires_at" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "memory_entries" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "custom_id" TEXT,
  "content_hash" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'fact',
  "scope" TEXT NOT NULL DEFAULT 'global',
  "topic" TEXT NOT NULL,
  "summary" TEXT,
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "confidence" INTEGER NOT NULL DEFAULT 70,
  "source_type" TEXT,
  "source_path" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_latest" INTEGER NOT NULL DEFAULT 1,
  "is_static" INTEGER NOT NULL DEFAULT 0,
  "root_memory_id" TEXT,
  "parent_memory_id" TEXT,
  "forget_after" TEXT,
  "metadata" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("user_id", "custom_id")
);
CREATE INDEX IF NOT EXISTS "memory_entries_user_hash_idx" ON "memory_entries" ("user_id", "content_hash");
CREATE INDEX IF NOT EXISTS "memory_entries_user_status_idx" ON "memory_entries" ("user_id", "status", "updated_at");
CREATE INDEX IF NOT EXISTS "memory_entries_user_topic_idx" ON "memory_entries" ("user_id", "topic");

CREATE TABLE IF NOT EXISTS "organization" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT,
  "logo" TEXT,
  "created_at" TEXT NOT NULL,
  "metadata" TEXT,
  UNIQUE ("slug")
);

CREATE TABLE IF NOT EXISTS "plugins" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "plugin_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "entrypoint" TEXT NOT NULL,
  "required_capabilities" TEXT NOT NULL DEFAULT '[]',
  "optional_capabilities" TEXT NOT NULL DEFAULT '[]',
  "permissions" TEXT NOT NULL DEFAULT '[]',
  "registered_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("plugin_id")
);

CREATE TABLE IF NOT EXISTS "privacy_audit_events" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "actor_user_id" TEXT,
  "target_user_id" TEXT,
  "event_type" TEXT NOT NULL,
  "resource_type" TEXT,
  "resource_id" TEXT,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "metadata" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "privacy_audit_events_actor_created_idx" ON "privacy_audit_events" ("actor_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "privacy_audit_events_target_created_idx" ON "privacy_audit_events" ("target_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "privacy_audit_events_type_idx" ON "privacy_audit_events" ("event_type", "created_at");

CREATE TABLE IF NOT EXISTS "privacy_consents" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "consent_version" TEXT NOT NULL,
  "privacy_policy_version" TEXT NOT NULL,
  "terms_version" TEXT NOT NULL,
  "app_version" TEXT,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "metadata" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "privacy_consents_user_purpose_idx" ON "privacy_consents" ("user_id", "purpose", "created_at");
CREATE INDEX IF NOT EXISTS "privacy_consents_user_status_idx" ON "privacy_consents" ("user_id", "status");

CREATE TABLE IF NOT EXISTS "privacy_deletion_jobs" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "steps" TEXT NOT NULL DEFAULT '[]',
  "error" TEXT,
  "requested_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TEXT
);
CREATE INDEX IF NOT EXISTS "privacy_deletion_jobs_user_status_idx" ON "privacy_deletion_jobs" ("user_id", "status", "requested_at");

CREATE TABLE IF NOT EXISTS "privacy_exports" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "format" TEXT NOT NULL DEFAULT 'json',
  "manifest" TEXT,
  "archive_url" TEXT,
  "archive_sha256" TEXT,
  "error" TEXT,
  "requested_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TEXT,
  "expires_at" TEXT
);
CREATE INDEX IF NOT EXISTS "privacy_exports_user_status_idx" ON "privacy_exports" ("user_id", "status", "requested_at");

CREATE TABLE IF NOT EXISTS "privacy_preferences" (
  "user_id" TEXT PRIMARY KEY NOT NULL,
  "conversation_history_enabled" INTEGER NOT NULL DEFAULT 0,
  "memory_enabled" INTEGER NOT NULL DEFAULT 0,
  "cloud_memory_enabled" INTEGER NOT NULL DEFAULT 0,
  "connectors_enabled" INTEGER NOT NULL DEFAULT 0,
  "analytics_enabled" INTEGER NOT NULL DEFAULT 0,
  "voice_processing_enabled" INTEGER NOT NULL DEFAULT 0,
  "ai_improvement_enabled" INTEGER NOT NULL DEFAULT 0,
  "telegram_processing_enabled" INTEGER NOT NULL DEFAULT 0,
  "retention_overrides" TEXT,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "processed_payment_events" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "provider" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "received_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("provider", "event_id")
);

CREATE TABLE IF NOT EXISTS "rag_retrieval_logs" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "query_hash" TEXT NOT NULL,
  "matched_chunk_ids" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "rag_retrieval_logs_user_idx" ON "rag_retrieval_logs" ("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "rag_sources" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "path" TEXT,
  "content_hash" TEXT,
  "source_type" TEXT NOT NULL,
  "privacy_scope" TEXT NOT NULL DEFAULT 'cloud_rag',
  "status" TEXT NOT NULL DEFAULT 'indexing',
  "sync_state" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("user_id", "path")
);
CREATE INDEX IF NOT EXISTS "rag_sources_user_idx" ON "rag_sources" ("user_id");

CREATE TABLE IF NOT EXISTS "telegram_link_tokens" (
  "token" TEXT PRIMARY KEY NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TEXT NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0,
  "telegram_user_id" TEXT
);

CREATE TABLE IF NOT EXISTS "user" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "email_verified" INTEGER NOT NULL DEFAULT 0,
  "image" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'user',
  "plan" TEXT NOT NULL DEFAULT 'explore',
  "subscription_status" TEXT NOT NULL DEFAULT 'inactive',
  "trial_start_date" TEXT,
  "trial_end_date" TEXT,
  "current_period_end" TEXT,
  "dodo_customer_id" TEXT,
  "dodo_subscription_id" TEXT,
  "trial_interaction_used" INTEGER NOT NULL DEFAULT 0,
  "trial_interaction_limit" INTEGER NOT NULL DEFAULT 100,
  "daily_chat_count" INTEGER NOT NULL DEFAULT 0,
  "daily_voice_count" INTEGER NOT NULL DEFAULT 0,
  "daily_image_count" INTEGER NOT NULL DEFAULT 0,
  "agent_usage_count" INTEGER NOT NULL DEFAULT 0,
  "daily_reset_date" TEXT,
  "agent_soul" TEXT,
  "soul_onboarding" TEXT NOT NULL DEFAULT 'unprompted',
  "pending_connector_nudge" TEXT,
  "referral_code" TEXT,
  "current_streak" INTEGER NOT NULL DEFAULT 0,
  "longest_streak" INTEGER NOT NULL DEFAULT 0,
  "last_active_date" TEXT,
  "total_messages_sent" INTEGER NOT NULL DEFAULT 0,
  "leaderboard_opt_in" INTEGER NOT NULL DEFAULT 1,
  "leaderboard_handle" TEXT,
  "leaderboard_show_photo" INTEGER NOT NULL DEFAULT 1,
  "deleted_at" TEXT,
  "privacy_preferences" TEXT NOT NULL DEFAULT '{}',
  "consent_version" TEXT,
  "consent_timestamp" TEXT,
  "privacy_policy_version" TEXT,
  "terms_version" TEXT,
  "last_export_at" TEXT,
  "export_count" INTEGER NOT NULL DEFAULT 0,
  UNIQUE ("leaderboard_handle"),
  UNIQUE ("referral_code"),
  UNIQUE ("email")
);

CREATE TABLE IF NOT EXISTS "verification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "created_at" TEXT,
  "updated_at" TEXT
);

CREATE TABLE IF NOT EXISTS "account" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "account_id" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "access_token" TEXT,
  "refresh_token" TEXT,
  "id_token" TEXT,
  "access_token_expires_at" TEXT,
  "refresh_token_expires_at" TEXT,
  "scope" TEXT,
  "password" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "agent_sessions" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "chat_id" TEXT NOT NULL,
  "title" TEXT,
  "summary" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "message_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_message_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TEXT,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "agent_sessions_user_platform_idx" ON "agent_sessions" ("user_id", "platform", "chat_id");
CREATE INDEX IF NOT EXISTS "agent_sessions_user_status_idx" ON "agent_sessions" ("user_id", "status", "last_message_at");

CREATE TABLE IF NOT EXISTS "composio_connections" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "toolkit" TEXT NOT NULL,
  "connected_account_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'INACTIVE',
  "status_reason" TEXT,
  "alias" TEXT,
  "connected_at" TEXT,
  "last_trigger_event_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE,
  UNIQUE ("user_id", "toolkit")
);
CREATE INDEX IF NOT EXISTS "composio_connections_account_idx" ON "composio_connections" ("connected_account_id");
CREATE INDEX IF NOT EXISTS "composio_connections_status_idx" ON "composio_connections" ("status");
CREATE INDEX IF NOT EXISTS "composio_connections_user_idx" ON "composio_connections" ("user_id");

CREATE TABLE IF NOT EXISTS "credit_accounts" (
  "user_id" TEXT PRIMARY KEY NOT NULL,
  "available_credits" INTEGER NOT NULL DEFAULT 0,
  "lifetime_granted" INTEGER NOT NULL DEFAULT 0,
  "lifetime_consumed" INTEGER NOT NULL DEFAULT 0,
  "lifetime_refunded" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "custom_mcp_servers" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "api_key_encrypted" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("user_id", "url"),
  FOREIGN KEY ("user_id") REFERENCES "user" ("id")
);

CREATE TABLE IF NOT EXISTS "devices" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "os" TEXT NOT NULL,
  "app_version" TEXT NOT NULL,
  "sidecar_url" TEXT,
  "last_seen" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "generated_suggestions" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "dedup_key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "schedule" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "deliver_to" TEXT,
  "connector" TEXT NOT NULL,
  "time_bucket" TEXT NOT NULL,
  "distinct_days" INTEGER NOT NULL,
  "generated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("user_id", "dedup_key"),
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "generated_suggestions_user_idx" ON "generated_suggestions" ("user_id");

CREATE TABLE IF NOT EXISTS "invitation" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "organization_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT,
  "status" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "inviter_id" TEXT NOT NULL,
  FOREIGN KEY ("inviter_id") REFERENCES "user" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("organization_id") REFERENCES "organization" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "mcp_connections" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "oauth_tokens" TEXT NOT NULL,
  "scopes" TEXT NOT NULL,
  "display_name" TEXT,
  "expires_at" TEXT,
  "last_sync_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("user_id", "provider"),
  FOREIGN KEY ("user_id") REFERENCES "user" ("id")
);

CREATE TABLE IF NOT EXISTS "member" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  FOREIGN KEY ("organization_id") REFERENCES "organization" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "memory_relations" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "from_memory_id" TEXT NOT NULL,
  "to_memory_id" TEXT NOT NULL,
  "relation_type" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("to_memory_id") REFERENCES "memory_entries" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("from_memory_id") REFERENCES "memory_entries" ("id") ON DELETE CASCADE,
  UNIQUE ("from_memory_id", "to_memory_id", "relation_type")
);
CREATE INDEX IF NOT EXISTS "memory_relations_user_from_idx" ON "memory_relations" ("user_id", "from_memory_id");

CREATE TABLE IF NOT EXISTS "payment_records" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "product_key" TEXT NOT NULL,
  "provider_customer_id" TEXT,
  "provider_order_id" TEXT,
  "provider_payment_id" TEXT,
  "provider_subscription_id" TEXT,
  "amount_cents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" TEXT NOT NULL DEFAULT 'created',
  "metadata" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("provider", "provider_order_id"),
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE,
  UNIQUE ("provider", "provider_payment_id")
);
CREATE INDEX IF NOT EXISTS "payment_records_user_idx" ON "payment_records" ("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "pending_actions" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "connector" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "risk" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "preview" TEXT NOT NULL,
  "confirm_text" TEXT,
  "payload" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "result" TEXT,
  "source_platform" TEXT,
  "source_chat_id" TEXT,
  "requested_by_run_id" TEXT,
  "expires_at" TEXT NOT NULL,
  "decided_at" TEXT,
  "executed_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "pending_actions_connector_action_idx" ON "pending_actions" ("connector", "action");
CREATE INDEX IF NOT EXISTS "pending_actions_expires_idx" ON "pending_actions" ("status", "expires_at");
CREATE INDEX IF NOT EXISTS "pending_actions_user_status_idx" ON "pending_actions" ("user_id", "status", "created_at");

CREATE TABLE IF NOT EXISTS "platform_connections" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "platform_user_id" TEXT NOT NULL,
  "platform_chat_id" TEXT,
  "connected_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("platform", "platform_user_id"),
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "platform_connections_platform_idx" ON "platform_connections" ("platform", "platform_user_id");
CREATE INDEX IF NOT EXISTS "platform_connections_user_idx" ON "platform_connections" ("user_id");

CREATE TABLE IF NOT EXISTS "rag_documents" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL DEFAULT 'text/plain',
  "content_hash" TEXT NOT NULL,
  "metadata" TEXT,
  "external_id" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("source_id") REFERENCES "rag_sources" ("id") ON DELETE CASCADE,
  UNIQUE ("source_id", "content_hash")
);
CREATE INDEX IF NOT EXISTS "rag_documents_source_external_idx" ON "rag_documents" ("source_id", "external_id");
CREATE INDEX IF NOT EXISTS "rag_documents_source_idx" ON "rag_documents" ("source_id");
CREATE INDEX IF NOT EXISTS "rag_documents_user_idx" ON "rag_documents" ("user_id");

CREATE TABLE IF NOT EXISTS "referral_events" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "referrer_user_id" TEXT NOT NULL,
  "referred_user_id" TEXT NOT NULL,
  "credits_granted" INTEGER NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("referred_user_id") REFERENCES "user" ("id") ON DELETE CASCADE,
  UNIQUE ("referred_user_id"),
  FOREIGN KEY ("referrer_user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "referral_events_referrer_user_id_idx" ON "referral_events" ("referrer_user_id");

CREATE TABLE IF NOT EXISTS "schedules" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "schedule" TEXT NOT NULL,
  "schedule_type" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "deliver_to" TEXT,
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "one_shot" INTEGER NOT NULL DEFAULT 0,
  "next_run_at" TEXT,
  "last_run_at" TEXT,
  "last_run_status" TEXT,
  "last_run_error" TEXT,
  "run_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "schedules_due_idx" ON "schedules" ("enabled", "next_run_at");
CREATE INDEX IF NOT EXISTS "schedules_user_idx" ON "schedules" ("user_id");

CREATE TABLE IF NOT EXISTS "session" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "expires_at" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "user_id" TEXT NOT NULL,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE,
  UNIQUE ("token")
);

CREATE TABLE IF NOT EXISTS "telegram_miniapp_login_tokens" (
  "token" TEXT PRIMARY KEY NOT NULL,
  "user_id" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "used_at" TEXT,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "agent_messages" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "session_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "metadata" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("session_id") REFERENCES "agent_sessions" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "agent_messages_session_created_idx" ON "agent_messages" ("session_id", "created_at");
CREATE INDEX IF NOT EXISTS "agent_messages_user_created_idx" ON "agent_messages" ("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "credit_grants" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "payment_id" TEXT,
  "source" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "credits_granted" INTEGER NOT NULL,
  "credits_remaining" INTEGER NOT NULL,
  "expires_at" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "metadata" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("payment_id") REFERENCES "payment_records" ("id"),
  UNIQUE ("source", "source_id")
);
CREATE INDEX IF NOT EXISTS "credit_grants_user_status_idx" ON "credit_grants" ("user_id", "status", "expires_at");

CREATE TABLE IF NOT EXISTS "rag_chunks" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "token_count" INTEGER NOT NULL DEFAULT 0,
  "metadata" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("document_id") REFERENCES "rag_documents" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "rag_chunks_document_idx" ON "rag_chunks" ("document_id");
CREATE INDEX IF NOT EXISTS "rag_chunks_user_idx" ON "rag_chunks" ("user_id");

CREATE TABLE IF NOT EXISTS "suggestion_decisions" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "dedup_key" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "schedule_id" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("user_id", "dedup_key"),
  FOREIGN KEY ("schedule_id") REFERENCES "schedules" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "suggestion_decisions_user_idx" ON "suggestion_decisions" ("user_id");

CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "device_id" TEXT,
  "kind" TEXT NOT NULL,
  "model" TEXT,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "cost_cents" INTEGER NOT NULL DEFAULT 0,
  "credits_charged" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'done',
  "metadata" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("device_id") REFERENCES "devices" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id")
);
CREATE INDEX IF NOT EXISTS "usage_events_user_kind_idx" ON "usage_events" ("user_id", "kind", "created_at");
CREATE INDEX IF NOT EXISTS "usage_events_user_period_idx" ON "usage_events" ("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "ai_usage_events" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "usage_event_id" TEXT,
  "user_id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "surface" TEXT NOT NULL,
  "route" TEXT,
  "intent" TEXT,
  "complexity" TEXT,
  "model" TEXT,
  "provider" TEXT,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "reasoning_tokens" INTEGER NOT NULL DEFAULT 0,
  "cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
  "embedding_tokens" INTEGER NOT NULL DEFAULT 0,
  "max_output_tokens" INTEGER NOT NULL DEFAULT 0,
  "tool_calls" INTEGER NOT NULL DEFAULT 0,
  "connector_count" INTEGER NOT NULL DEFAULT 0,
  "connector_ids" TEXT NOT NULL DEFAULT '[]',
  "vision_images" INTEGER NOT NULL DEFAULT 0,
  "voice_duration_seconds" INTEGER NOT NULL DEFAULT 0,
  "tts_chars" INTEGER NOT NULL DEFAULT 0,
  "stt_audio_seconds" INTEGER NOT NULL DEFAULT 0,
  "latency_ms" INTEGER NOT NULL DEFAULT 0,
  "first_token_latency_ms" INTEGER,
  "total_api_cost_micros" INTEGER NOT NULL DEFAULT 0,
  "credit_policy_version" TEXT NOT NULL DEFAULT 'static-v1',
  "credits_estimated" INTEGER NOT NULL DEFAULT 0,
  "credits_charged" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'started',
  "error_code" TEXT,
  "metadata" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TEXT,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("usage_event_id") REFERENCES "usage_events" ("id") ON DELETE SET NULL,
  UNIQUE ("request_id")
);
CREATE INDEX IF NOT EXISTS "ai_usage_events_endpoint_idx" ON "ai_usage_events" ("endpoint", "created_at");
CREATE INDEX IF NOT EXISTS "ai_usage_events_model_idx" ON "ai_usage_events" ("model", "created_at");
CREATE INDEX IF NOT EXISTS "ai_usage_events_status_idx" ON "ai_usage_events" ("status");
CREATE INDEX IF NOT EXISTS "ai_usage_events_usage_event_idx" ON "ai_usage_events" ("usage_event_id");
CREATE INDEX IF NOT EXISTS "ai_usage_events_user_created_idx" ON "ai_usage_events" ("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "credit_transactions" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "grant_id" TEXT,
  "usage_event_id" TEXT,
  "payment_id" TEXT,
  "type" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "balance_after" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "reason" TEXT,
  "metadata" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("grant_id") REFERENCES "credit_grants" ("id"),
  UNIQUE ("idempotency_key"),
  FOREIGN KEY ("payment_id") REFERENCES "payment_records" ("id"),
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("usage_event_id") REFERENCES "usage_events" ("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "credit_transactions_user_created_idx" ON "credit_transactions" ("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "memory_sources" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "memory_id" TEXT NOT NULL,
  "document_id" TEXT,
  "chunk_id" TEXT,
  "source_path" TEXT,
  "relevance" INTEGER NOT NULL DEFAULT 100,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("chunk_id") REFERENCES "rag_chunks" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("document_id") REFERENCES "rag_documents" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("memory_id") REFERENCES "memory_entries" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "memory_sources_memory_idx" ON "memory_sources" ("memory_id");

CREATE TABLE IF NOT EXISTS vector_sync_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('memory', 'rag')),
  record_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  payload TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  UNIQUE (kind, record_id, revision, operation)
);
CREATE INDEX IF NOT EXISTS vector_sync_pending_idx ON vector_sync_outbox (processed_at, created_at);
