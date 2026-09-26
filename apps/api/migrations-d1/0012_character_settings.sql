-- Per-user switches for any character, your own or from the gallery.
-- No row means the defaults: texts you first, and keeps Yomi's tools.
CREATE TABLE IF NOT EXISTS "character_settings" (
  "user_id" TEXT NOT NULL,
  "character_id" TEXT NOT NULL,
  "texts_first" INTEGER NOT NULL DEFAULT 1,
  "uses_tools" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("user_id", "character_id"),
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
