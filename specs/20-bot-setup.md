# Spec 20 — Messaging Bot Setup & Linking

## Purpose

Document existing bot registrations, creation steps, and the user-linking flow.

---

## Bot Registry

### Telegram

| Field            | Value                                                     |
| ---------------- | --------------------------------------------------------- |
| Bot handle       | `@yomi_assistant_bot`                                     |
| Token            | `TELEGRAM_BOT_TOKEN` in `.env`                            |
| Created via      | [@BotFather](https://t.me/botfather)                      |
| Adapter          | `apps/backend/src/gateway/platforms/telegram.ts`          |
| Polling          | HTTP long-poll `getUpdates` every 3s                      |
| Deep-link URL    | `https://t.me/yomi_assistant_bot?start=TOKEN`             |

### Discord

| Field            | Value                                                     |
| ---------------- | --------------------------------------------------------- |
| Bot app          | Discord Developer Portal                                  |
| Bot name         | `yomi`                                                    |
| Bot client ID    | `1513769981773480068`                                     |
| Token            | `DISCORD_BOT_TOKEN` in `.env`                             |
| Adapter          | `apps/backend/src/gateway/platforms/discord.ts`           |
| Connection       | Gateway WebSocket (`wss://gateway.discord.gg`)            |
| Gateway intents  | `MESSAGE_CONTENT` (1<<15), `DIRECT_MESSAGES` (1<<12), `GUILDS` (1<<0) |
| Slash command    | `/link` (registered globally on startup)                  |

---

## User Linking Flows

### Telegram deep-link (primary, production)

```
Dashboard → "Connect Telegram"
  → POST /api/gateway/telegram/token (authenticated)
  → Backend generates 32-char hex token, INSERT telegram_link_tokens (15 min TTL)
  → Returns { deepLink: "https://t.me/yomi_assistant_bot?start=TOKEN" }
  → Frontend opens deep link
  → User presses Start in Telegram
  → Bot receives /start TOKEN
  → onIncoming intercepts /start, calls handleTelegramDeepLink
  → Validates token (exists, not expired, not used)
  → INSERT platform_connections
  → Bot replies: "Telegram successfully linked to your Yomi account."
```

### Telegram manual (fallback)

```
User messages bot → isUserLinked returns false
  → generateLinkingCode → INSERT linking_codes (10 min TTL)
  → Bot replies with 6-char code and /link URL
  → User visits /link, enters code
  → POST /api/gateway/link → verifyLinkingCode → INSERT platform_connections
```

### Discord

```
Dashboard → "Add Discord"
  → GET /api/gateway/discord/auth (OAuth2, identify scope, userId in state)
  → Discord OAuth → callback → generate 6-char code
  → INSERT linking_codes (with userId, platformUserId)
  → Redirect to /link?code=ABC123&discord_ready=true

Then either:
  A) User enters code on /link page → POST /api/gateway/link → linked
  B) User types /link ABC123 in any server → handleDiscordLinkCode → linked

Once linked, DMs arrive via Gateway MESSAGE_CREATE events
  → onMessageCreate filters DMs (no guild_id)
  → messageHandler → onIncoming → queueForUser → sidecar polls
```

---

## Linking Code Storage

Codes are stored in the `linking_codes` database table:

| Column           | Type      | Notes                                         |
| ---------------- | --------- | --------------------------------------------- |
| code             | text      | Primary key, 6-char uppercase hex             |
| platform         | text      | `"telegram"` or `"discord"`                   |
| platform_user_id | text      | User's ID on the external platform            |
| platform_chat_id | text      | Chat/channel ID (nullable)                    |
| user_id          | text      | Yomi user ID (nullable, from OAuth state)     |
| expires_at       | timestamp | 10 minutes from creation                      |

Cleanup: `cleanupExpiredCodes()` runs every 5 min, deletes expired rows.

### Telegram deep-link tokens

Stored in `telegram_link_tokens`:

| Column           | Type      | Notes                                         |
| ---------------- | --------- | --------------------------------------------- |
| token            | text      | Primary key, 32-char hex                      |
| user_id          | text      | Yomi user ID                                  |
| created_at       | timestamp | Auto-set                                      |
| expires_at       | timestamp | 15 minutes from creation                      |
| used             | boolean   | One-time use, marked on successful link        |
| telegram_user_id | text      | Set on successful link (nullable)             |

---

## Database

### `platform_connections`

| Column            | Type      | Notes                                         |
| ----------------- | --------- | --------------------------------------------- |
| id                | uuid      | Primary key, auto-generated                   |
| user_id           | text      | FK → user(id), cascading delete               |
| platform          | text      | `"telegram"` or `"discord"`                   |
| platform_user_id  | text      | User's ID on the external platform            |
| platform_chat_id  | text      | Chat/channel ID (nullable)                    |
| connected_at      | timestamp | Auto-set on insert                            |
| updated_at        | timestamp | Auto-set on insert                            |

Unique constraint on `(platform, platform_user_id)`.

---

## Env Vars

```bash
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=yomi_assistant_bot
TELEGRAM_DEEP_LINK_ENABLED=true

DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=1513769981773480068
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=https://yomi.arka6fx.com/api/gateway/discord/callback
```

---

## Key Files

| File | Purpose |
| ---- | ------- |
| `apps/backend/src/gateway/gateway-runner.ts` | onIncoming, handleDiscordLinkCode, handleTelegramDeepLink, createTelegramLinkToken |
| `apps/backend/src/gateway/routes.ts` | POST /telegram/token, POST /link, POST /send, OAuth auth+callback |
| `apps/backend/src/gateway/platforms/telegram.ts` | HTTP polling adapter, botUsername |
| `apps/backend/src/gateway/platforms/discord.ts` | Gateway WebSocket, /link slash command, MESSAGE_CREATE handler |
| `apps/backend/src/gateway/platform-adapter.ts` | PlatformAdapter interface |
| `packages/db/src/schema.ts` | platform_connections, linking_codes, telegram_link_tokens |
| `apps/landing/src/app/link/page.tsx` | Link page with one-click Telegram + Discord connect |
| `apps/landing/src/app/dashboard/page.tsx` | Dashboard with platform connection management |
| `specs/19-hermes-features.md` | Cloud Messaging Gateway architecture |
