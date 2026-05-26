ALTER TABLE "rag_sources" ADD COLUMN IF NOT EXISTS "path" text;
--> statement-breakpoint
ALTER TABLE "rag_sources" ADD COLUMN IF NOT EXISTS "content_hash" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rag_sources_user_path_unique" ON "rag_sources" USING btree ("user_id","path");
