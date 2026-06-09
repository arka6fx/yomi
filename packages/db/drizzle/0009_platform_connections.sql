CREATE TABLE IF NOT EXISTS "platform_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_user_id" text NOT NULL,
	"platform_chat_id" text,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_connections_platform_user_unique" UNIQUE("platform","platform_user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_connections" ADD CONSTRAINT "platform_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "sidecar_url" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_connections_user_idx" ON "platform_connections" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_connections_platform_idx" ON "platform_connections" USING btree ("platform","platform_user_id");
