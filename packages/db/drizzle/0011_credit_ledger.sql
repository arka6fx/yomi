ALTER TABLE "usage_events" ADD COLUMN IF NOT EXISTS "credits_charged" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
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
DO $$ BEGIN
 ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
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
CREATE INDEX IF NOT EXISTS "payment_records_user_idx" ON "payment_records" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_grants_user_status_idx" ON "credit_grants" USING btree ("user_id","status","expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_transactions_user_created_idx" ON "credit_transactions" USING btree ("user_id","created_at");
