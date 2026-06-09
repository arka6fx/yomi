# Spec 20 — Messaging Bot Setup & Linking

## Purpose

Document existing bot registrations, creation steps, and the user-linking flow
so anyone can recreate or audit the platform bot configuration.

---

## Bot Registry

### Telegram

| Field            | Value                                                               |
| ---------------- | ------------------------------------------------------------------- |
| Bot handle       | `@yomi_assistant_bot`                                               |
| Token            | Set in `TELEGRAM_BOT_TOKEN` in `.env`                               |
| Created via      | [@BotFather](https://t.me/botfather) on Telegram                    |
| Adapter          | `apps/backend/src/gateway/platforms/telegram.ts`                    |
| Polling          | HTTP long-poll `getUpdates` every 3 s — no webhook needed           |
| Link invite      | `https://t.me/yomi_assistant_bot`                                   |

**Creation steps (reference):**
1. Open Telegram → search `@BotFather` → tap Start
2. Send `/newbot` → follow prompts for name and username
3. BotFather returns the token — set as `TELEGRAM_BOT_TOKEN`
4. (Optional) `/setdescription` → "Yomi — your AI desktop assistant"
5. (Optional) `/setuserpic` → upload Yomi logo

### Discord

| Field            | Value                                                               |
| ---------------- | ------------------------------------------------------------------- |
| Bot application  | Discord Developer Portal → Applications → yomi-assistant            |
| Token            | Set in `DISCORD_BOT_TOKEN` in `.env`                                |
| Created via      | [Discord Developer Portal](https://discord.com/developers/applications) |
| Bot client ID    | `1513769981773480068` (derived from token payload)                  |
| Adapter          | `apps/backend/src/gateway/platforms/discord.ts`                     |
| Gateway intents  | Requires `GUILD_MESSAGES`, `DIRECT_MESSAGES`, `MESSAGE_CONTENT`     |
| Invite URL       | (needs to be generated — see below)                                 |

**Invite URL:**
```
https://discord.com/api/oauth2/authorize?client_id=1513769981773480068&permissions=2048&scope=bot
```
Open this link in a browser to add the bot to a server.
Permissions `2048` = Send Messages only. Add more as needed.

**Creation steps (reference):**
1. Go to https://discord.com/developers/applications → New Application
2. Name: "Yomi Assistant" → Bot → Add Bot
3. Under Bot tab: enable `SERVER MEMBERS INTENT`, `MESSAGE CONTENT INTENT`
4. Copy the token → set as `DISCORD_BOT_TOKEN`
5. Under OAuth2 → URL Generator → scopes: `bot` → permissions: `Send Messages`
6. Use generated URL to invite the bot to a server

### WhatsApp

| Field            | State         | Notes                                                         |
| ---------------- | ------------- | ------------------------------------------------------------- |
| Access token     | Not set       | `WHATSAPP_ACCESS_TOKEN` not in `.env`                         |
| Phone number ID  | Not set       | `WHATSAPP_PHONE_NUMBER_ID` not in `.env`                      |
| Setup required   | Meta Business | Requires Meta Business Account + WhatsApp Cloud API setup     |
| Webhook          | Backend       | `GET/POST /api/gateway/webhooks/whatsapp` in `routes.ts`      |

### Slack

| Field            | State         | Notes                                                         |
| ---------------- | ------------- | ------------------------------------------------------------- |
| Bot token        | Not set       | `SLACK_BOT_TOKEN` not in `.env`                               |
| Setup required   | Slack API     | Create Slack app, add Bot token with `chat:write` scope       |

---

## User Linking Flow

```
┌──────────┐   message    ┌─────────────────┐   check platform_connections
│ Telegram  │ ──────────→  │  Backend (:3001) │ ──────────────────────────────┐
│   User    │              │  (gateway-runner) │                              │
└──────────┘              └─────────────────┘                              │
     ↑                          │                                           │
     │    "Your code: ABC123"    │  No row found                             │
     │    "Visit domain/link"    │  ← generate 6-char hex code, store 10min │
     │                          ▼                                           │
     │                     ┌──────────┐                                     │
     │                     │ Browser  │                                     │
     │                     │ (logged  │                                     │
     │                     │  in)     │                                     │
     │                     └────┬─────┘                                     │
     │                          │ POST /api/gateway/link { code: "ABC123" } │
     │                          ▼                                           │
     │                     ┌──────────────────┐                             │
     │  "✅ Linked!"       │  Verify code →   │                             │
     │  ←─────────────────│  INSERT into     │                             │
     │                     │  platform_conn   │                             │
     │                     └──────────────────┘                             │
```

### Step by step

1. **User messages the bot** — any platform (Telegram, Discord, etc.)
2. **Backend checks `platform_connections`** — `SELECT id FROM platform_connections WHERE platform = $1 AND platform_user_id = $2`
3. **No row found** → backend generates a random 6-char hex code, stores in-memory with 10-min TTL
4. **Bot replies** with the linking prompt:
   > "Welcome to Yomi! Your account isn't linked yet.
   > Your code: **ABC123**
   > Visit https://yomi.arka6fx.com/link and enter this code."
5. **User opens browser**, logs into Yomi (OAuth), enters code
6. **`POST /api/gateway/link`** (authenticated, requires session):
   - Verifies the code via `GatewayRunner.verifyLinkingCode()`
   - Creates row in `platform_connections`:
     - `user_id` — from the authenticated session
     - `platform` — e.g. `"telegram"`
     - `platform_user_id` — the Telegram user ID
     - `platform_chat_id` — the chat ID
   - Sends confirmation message via the bot
7. **Subsequent messages** — connection exists → forward to sidecar

### Linking code storage

Codes are stored in-memory in `GatewayRunner.linkingCodes`:
- Key: 6-char uppercase hex string (e.g. `"A3F2B1"`)
- Value: `{ platform, platformUserId, chatId, expiresAt }`
- TTL: 10 minutes
- Cleaned up every 5 min by `cleanupLinkingCodes()`

---

## Database

### `platform_connections` table

Defined in `packages/db/src/schema.ts`:

| Column            | Type      | Notes                                         |
| ----------------- | --------- | --------------------------------------------- |
| id                | uuid      | Primary key, auto-generated                   |
| user_id           | uuid      | FK → user(id), cascading delete               |
| platform          | text      | `"telegram" \| "discord" \| "slack" \| "whatsapp"` |
| platform_user_id  | text      | User's ID on the external platform            |
| platform_chat_id  | text      | Specific chat/channel (nullable)              |
| connected_at      | timestamp | Auto-set on insert                            |
| updated_at        | timestamp | Auto-set on insert                            |

Unique constraint on `(platform, platform_user_id)`.

### `devices.sidecar_url`

Added to `devices` table in `packages/db/src/schema.ts`:

| Column      | Type | Notes                                      |
| ----------- | ---- | ------------------------------------------ |
| sidecar_url | text | URL of the user's sidecar (nullable)       |

When a message arrives from a linked user, the backend looks up:
1. `platform_connections` → gets `yomi_user_id`
2. `devices` WHERE `user_id = yomi_user_id` → gets `sidecar_url`
3. Forwards message to that sidecar URL

Falls back to `SIDECAR_URL` env var if no device found.

---

## Key Files

| File | Purpose |
| ---- | ------- |
| `apps/backend/src/gateway/gateway-runner.ts` | Link check in `onIncoming`, code generation, `verifyLinkingCode()` |
| `apps/backend/src/gateway/routes.ts` | `POST /api/gateway/link` endpoint |
| `apps/backend/src/gateway/platforms/telegram.ts` | Telegram polling adapter |
| `apps/backend/src/gateway/platforms/discord.ts` | Discord gateway adapter |
| `packages/db/src/schema.ts` | `platform_connections` table + `devices.sidecar_url` |
| `packages/shared/src/index.ts` | `PlatformConnection`, `PlatformType` types |
| `apps/sidecar/src/gateway/receive.ts` | Processes forwarded messages, runs fast/agent pipeline |
| `specs/19-hermes-features.md` §6 | Cloud Messaging Gateway architecture |

---

## Next Steps

1. Generate Discord invite URL and add the bot to a test server
2. Build the `/link` page on the landing site (or a simple static page)
3. Set `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` if WhatsApp is needed
4. Set `SLACK_BOT_TOKEN` if Slack is needed
5. Deploy backend to production so Telegram/Discord can reach it 24/7
6. Test full linking flow end-to-end with a new Telegram user
