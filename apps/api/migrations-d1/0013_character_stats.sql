-- One row each time someone starts talking to a gallery character: totals,
-- "this week" counts and (later) trending all come from here.
CREATE TABLE IF NOT EXISTS "character_chats" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "user_id" TEXT NOT NULL,
  "character_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "character_chats_character_idx"
  ON "character_chats" ("character_id", "created_at");

-- A user's ♥ on a gallery character; one per user per character.
CREATE TABLE IF NOT EXISTS "character_likes" (
  "user_id" TEXT NOT NULL,
  "character_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("user_id", "character_id"),
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "character_likes_character_idx"
  ON "character_likes" ("character_id");
