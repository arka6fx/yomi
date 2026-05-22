CREATE TABLE IF NOT EXISTS "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"status" text NOT NULL,
	"task" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"steps_count" integer DEFAULT 0 NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"summary" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"os" text NOT NULL,
	"app_version" text NOT NULL,
	"last_seen" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hook_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"hook" text NOT NULL,
	"tool" text,
	"decision" text,
	"payload_redacted" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"oauth_tokens" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_connections_user_provider_unique" UNIQUE("user_id","provider")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_blobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"path" text NOT NULL,
	"content_hash" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memory_blobs_user_path_unique" UNIQUE("user_id","path")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_sub_id" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"kind" text NOT NULL,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'done' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hook_logs" ADD CONSTRAINT "hook_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hook_logs" ADD CONSTRAINT "hook_logs_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_blobs" ADD CONSTRAINT "memory_blobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_runs_user_status_idx" ON "agent_runs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hook_logs_agent_run_idx" ON "hook_logs" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_blobs_user_path_idx" ON "memory_blobs" USING btree ("user_id","path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_user_period_idx" ON "usage_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_user_kind_idx" ON "usage_events" USING btree ("user_id","kind","created_at");