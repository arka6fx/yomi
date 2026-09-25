-- Characters: personas that take over the user's Yomi chat until they switch back.
-- Built-in gallery characters live in code (services/characters.py), not here.
CREATE TABLE IF NOT EXISTS "characters" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "emoji" TEXT NOT NULL DEFAULT '🙂',
  "color" TEXT NOT NULL DEFAULT '#2b8fff',
  "appearance" TEXT NOT NULL DEFAULT '',
  "personality" TEXT NOT NULL DEFAULT '',
  "tagline" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "first_lines" TEXT NOT NULL DEFAULT '[]',
  "tags" TEXT NOT NULL DEFAULT '[]',
  "relationship" TEXT NOT NULL DEFAULT '',
  "based_on" TEXT NOT NULL DEFAULT '',
  "image_url" TEXT NOT NULL DEFAULT '',
  "image_credit" TEXT NOT NULL DEFAULT '',
  "chats" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "characters_user_idx" ON "characters" ("user_id", "updated_at");

-- Who answers a user's messages right now; no row means plain Yomi.
CREATE TABLE IF NOT EXISTS "active_characters" (
  "user_id" TEXT PRIMARY KEY NOT NULL,
  "character_id" TEXT NOT NULL,
  "activated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);

-- Gallery characters a user added to "your characters".
CREATE TABLE IF NOT EXISTS "character_saves" (
  "user_id" TEXT NOT NULL,
  "character_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("user_id", "character_id"),
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
