CREATE TABLE IF NOT EXISTS "telegram_miniapp_login_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "telegram_miniapp_login_tokens" ADD CONSTRAINT "telegram_miniapp_login_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
