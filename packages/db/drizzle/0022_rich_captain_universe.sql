CREATE TABLE IF NOT EXISTS "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"chat_id" text NOT NULL,
	"title" text,
	"summary" text,
	"status" text DEFAULT 'active' NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"available_credits" integer DEFAULT 0 NOT NULL,
	"lifetime_granted" integer DEFAULT 0 NOT NULL,
	"lifetime_consumed" integer DEFAULT 0 NOT NULL,
	"lifetime_refunded" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"payment_id" uuid,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"credits_granted" integer NOT NULL,
	"credits_remaining" integer NOT NULL,
	"expires_at" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_grants_source_unique" UNIQUE("source","source_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"grant_id" uuid,
	"usage_event_id" uuid,
	"payment_id" uuid,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_transactions_idempotency_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_codes" (
	"device_code" text PRIMARY KEY NOT NULL,
	"user_code" text NOT NULL,
	"client_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "linking_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"platform_user_id" text NOT NULL,
	"platform_chat_id" text,
	"user_id" text,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"memory_id" uuid NOT NULL,
	"model" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"custom_id" text,
	"content_hash" text NOT NULL,
	"kind" text DEFAULT 'fact' NOT NULL,
	"scope" text DEFAULT 'global' NOT NULL,
	"topic" text NOT NULL,
	"summary" text,
	"content" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"confidence" integer DEFAULT 70 NOT NULL,
	"source_type" text,
	"source_path" text,
	"version" integer DEFAULT 1 NOT NULL,
	"is_latest" boolean DEFAULT true NOT NULL,
	"is_static" boolean DEFAULT false NOT NULL,
	"root_memory_id" uuid,
	"parent_memory_id" uuid,
	"forget_after" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memory_entries_user_custom_unique" UNIQUE("user_id","custom_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"from_memory_id" uuid NOT NULL,
	"to_memory_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memory_relations_unique" UNIQUE("from_memory_id","to_memory_id","relation_type")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memory_id" uuid NOT NULL,
	"document_id" uuid,
	"chunk_id" uuid,
	"source_path" text,
	"relevance" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"product_key" text NOT NULL,
	"provider_customer_id" text,
	"provider_order_id" text,
	"provider_payment_id" text,
	"provider_subscription_id" text,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_records_provider_payment_unique" UNIQUE("provider","provider_payment_id"),
	CONSTRAINT "payment_records_provider_order_unique" UNIQUE("provider","provider_order_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pending_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"connector" text NOT NULL,
	"action" text NOT NULL,
	"risk" text NOT NULL,
	"title" text NOT NULL,
	"preview" text NOT NULL,
	"confirm_text" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"source_platform" text,
	"source_chat_id" text,
	"requested_by_run_id" uuid,
	"expires_at" timestamp NOT NULL,
	"decided_at" timestamp,
	"executed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"platform_user_id" text NOT NULL,
	"platform_chat_id" text,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_connections_platform_user_unique" UNIQUE("platform","platform_user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processed_payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "processed_payment_events_provider_event_unique" UNIQUE("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rag_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rag_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"title" text NOT NULL,
	"mime_type" text DEFAULT 'text/plain' NOT NULL,
	"content_hash" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rag_documents_source_hash_unique" UNIQUE("source_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rag_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"chunk_id" uuid NOT NULL,
	"model" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rag_retrieval_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"query_hash" text NOT NULL,
	"matched_chunk_ids" text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rag_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"path" text,
	"content_hash" text,
	"source_type" text NOT NULL,
	"privacy_scope" text DEFAULT 'cloud_rag' NOT NULL,
	"status" text DEFAULT 'indexing' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rag_sources_user_path_unique" UNIQUE("user_id","path")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"schedule" text NOT NULL,
	"schedule_type" text NOT NULL,
	"prompt" text NOT NULL,
	"deliver_to" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"one_shot" boolean DEFAULT false NOT NULL,
	"next_run_at" timestamp,
	"last_run_at" timestamp,
	"last_run_status" text,
	"last_run_error" text,
	"run_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telegram_link_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"telegram_user_id" text
);
--> statement-breakpoint
DROP TABLE "agent_runs";--> statement-breakpoint
DROP TABLE "hook_logs";--> statement-breakpoint
DROP TABLE "memory_blobs";--> statement-breakpoint
DROP TABLE "subscriptions";--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "sidecar_url" text;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD COLUMN "last_sync_at" timestamp;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "credits_charged" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_payment_id_payment_records_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment_records"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_grant_id_credit_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."credit_grants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_usage_event_id_usage_events_id_fk" FOREIGN KEY ("usage_event_id") REFERENCES "public"."usage_events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_payment_id_payment_records_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment_records"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_memory_id_memory_entries_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_relations" ADD CONSTRAINT "memory_relations_from_memory_id_memory_entries_id_fk" FOREIGN KEY ("from_memory_id") REFERENCES "public"."memory_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_relations" ADD CONSTRAINT "memory_relations_to_memory_id_memory_entries_id_fk" FOREIGN KEY ("to_memory_id") REFERENCES "public"."memory_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_sources" ADD CONSTRAINT "memory_sources_memory_id_memory_entries_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_sources" ADD CONSTRAINT "memory_sources_document_id_rag_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."rag_documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_sources" ADD CONSTRAINT "memory_sources_chunk_id_rag_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."rag_chunks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_connections" ADD CONSTRAINT "platform_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_chunks" ADD CONSTRAINT "rag_chunks_document_id_rag_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."rag_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_documents" ADD CONSTRAINT "rag_documents_source_id_rag_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."rag_sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_embeddings" ADD CONSTRAINT "rag_embeddings_chunk_id_rag_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."rag_chunks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedules" ADD CONSTRAINT "schedules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_messages_session_created_idx" ON "agent_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_messages_user_created_idx" ON "agent_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_user_platform_idx" ON "agent_sessions" USING btree ("user_id","platform","chat_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_user_status_idx" ON "agent_sessions" USING btree ("user_id","status","last_message_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_grants_user_status_idx" ON "credit_grants" USING btree ("user_id","status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_transactions_user_created_idx" ON "credit_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_codes_user_code_idx" ON "device_codes" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_codes_expires_at_idx" ON "device_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_embeddings_user_idx" ON "memory_embeddings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_embeddings_memory_idx" ON "memory_embeddings" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_entries_user_status_idx" ON "memory_entries" USING btree ("user_id","status","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_entries_user_topic_idx" ON "memory_entries" USING btree ("user_id","topic");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_entries_user_hash_idx" ON "memory_entries" USING btree ("user_id","content_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_relations_user_from_idx" ON "memory_relations" USING btree ("user_id","from_memory_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_sources_memory_idx" ON "memory_sources" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_records_user_idx" ON "payment_records" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_actions_user_status_idx" ON "pending_actions" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_actions_expires_idx" ON "pending_actions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_actions_connector_action_idx" ON "pending_actions" USING btree ("connector","action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_connections_user_idx" ON "platform_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_connections_platform_idx" ON "platform_connections" USING btree ("platform","platform_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_chunks_user_idx" ON "rag_chunks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_chunks_document_idx" ON "rag_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_documents_user_idx" ON "rag_documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_documents_source_idx" ON "rag_documents" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_embeddings_user_idx" ON "rag_embeddings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_embeddings_chunk_idx" ON "rag_embeddings" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_retrieval_logs_user_idx" ON "rag_retrieval_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_sources_user_idx" ON "rag_sources" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedules_user_idx" ON "schedules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedules_due_idx" ON "schedules" USING btree ("enabled","next_run_at");