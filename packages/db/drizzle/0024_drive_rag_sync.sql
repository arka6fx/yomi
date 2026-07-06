ALTER TABLE rag_sources ADD COLUMN IF NOT EXISTS sync_state jsonb;
ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS external_id text;
CREATE INDEX IF NOT EXISTS rag_documents_source_external_idx
  ON rag_documents (source_id, external_id);
