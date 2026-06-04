ALTER TABLE "rag_documents" DROP CONSTRAINT IF EXISTS "rag_documents_user_hash_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "rag_documents_user_hash_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rag_documents_source_hash_unique" ON "rag_documents" USING btree ("source_id","content_hash");
