-- 0033 — Drop screen_processing_enabled (backed the retired desktop
-- look_at_screen tool, never gated anything) and rag_processing_enabled
-- (duplicate of cloud_memory_enabled, never gated anything either).

alter table "privacy_preferences"
drop column if exists "screen_processing_enabled";
--> statement-breakpoint
alter table "privacy_preferences"
drop column if exists "rag_processing_enabled";
