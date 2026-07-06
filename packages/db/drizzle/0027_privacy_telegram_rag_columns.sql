-- 0027 — Add telegram_processing_enabled and rag_processing_enabled
-- to privacy_preferences for the new consent toggles.

alter table "privacy_preferences"
add column if not exists "telegram_processing_enabled" boolean not null default false;
--> statement-breakpoint
alter table "privacy_preferences"
add column if not exists "rag_processing_enabled" boolean not null default false;
