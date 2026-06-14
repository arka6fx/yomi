-- add display_name and last_sync_at to mcp_connections for the integrations UI
ALTER TABLE "mcp_connections" ADD COLUMN IF NOT EXISTS "display_name" text;
ALTER TABLE "mcp_connections" ADD COLUMN IF NOT EXISTS "last_sync_at" timestamp;
