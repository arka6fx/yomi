CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "rag_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "source_type" text NOT NULL,
  "privacy_scope" text DEFAULT 'cloud_rag' NOT NULL,
  "status" text DEFAULT 'indexing' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rag_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "source_id" uuid NOT NULL,
  "title" text NOT NULL,
  "mime_type" text DEFAULT 'text/plain' NOT NULL,
  "content_hash" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "rag_documents_user_hash_unique" UNIQUE("user_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rag_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "document_id" uuid NOT NULL,
  "chunk_index" integer NOT NULL,
  "content" text NOT NULL,
  "token_count" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rag_embeddings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "chunk_id" uuid NOT NULL,
  "model" text NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rag_retrieval_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "query_hash" text NOT NULL,
  "matched_chunk_ids" text[] NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_sources" ADD CONSTRAINT "rag_sources_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_documents" ADD CONSTRAINT "rag_documents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_documents" ADD CONSTRAINT "rag_documents_source_id_rag_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."rag_sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_chunks" ADD CONSTRAINT "rag_chunks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_chunks" ADD CONSTRAINT "rag_chunks_document_id_rag_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."rag_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_embeddings" ADD CONSTRAINT "rag_embeddings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_embeddings" ADD CONSTRAINT "rag_embeddings_chunk_id_rag_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."rag_chunks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rag_retrieval_logs" ADD CONSTRAINT "rag_retrieval_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_sources_user_idx" ON "rag_sources" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_documents_user_idx" ON "rag_documents" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_documents_source_idx" ON "rag_documents" USING btree ("source_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_chunks_user_idx" ON "rag_chunks" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_chunks_document_idx" ON "rag_chunks" USING btree ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_embeddings_user_idx" ON "rag_embeddings" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_embeddings_chunk_idx" ON "rag_embeddings" USING btree ("chunk_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_retrieval_logs_user_idx" ON "rag_retrieval_logs" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rag_embeddings_vector_idx" ON "rag_embeddings" USING hnsw ("embedding" vector_cosine_ops);
