CREATE TABLE IF NOT EXISTS "linking_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"platform_user_id" text NOT NULL,
	"platform_chat_id" text,
	"expires_at" timestamp NOT NULL
);
