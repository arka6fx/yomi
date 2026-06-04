ALTER TABLE "rag_chunks" ADD COLUMN IF NOT EXISTS "content_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_chunks_tsv_idx" ON "rag_chunks" USING gin ("content_tsv");
