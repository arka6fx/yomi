# Telegram inline controls + mini-app dashboard — design

Status: approved Date: 2026-08-09

## Problem

Yomi's Telegram bot exposes `/stop`, `/new`, `/start`, `/help`, `/approve`,
`/deny`, and `/pending` as literal slash commands. Telegram surfaces these in
the client's `/` autocomplete popup above the message box — a wall of raw
command syntax that reads as a dev tool, not a product. There is also no way
to reach Yomi's existing web dashboard
(`apps/landing/src/app/dashboard/page.tsx` — account linking, schedules,
memory, billing) from inside Telegram at all; a user has to know the
`getyomi.in` URL and log in separately.

Reference UX (Folk, a comparable Telegram-based assistant): no visible slash
commands, and a persistent pill button next to the message box that opens the
app's own dashboard as an embedded webview.

## Goal

- The `/` autocomplete popup shows nothing.
- `/stop`, `/new`, `/approve`, `/deny` keep working, but as tappable inline
  buttons attached to the bot's own messages instead of typed commands.
- A menu button next to the message box (Telegram's native
  `web_app`-type chat menu button) opens Yomi's existing dashboard inside
  Telegram, auto-signed-in.

## Non-goals

- Redesigning the dashboard UI itself. The existing `/dashboard` route is
  reused as-is; only its entry point (a new mini-app landing page that
  establishes a session, then hands off to it) is new.
- Changing the natural-language approve/deny path (`handleApprovalCommand`'s
  yes/no/"do it"/"send it" matching, `gateway-runner.ts:230-253`). That was
  never a slash command shown in the popup, and stays exactly as-is — inline
  buttons are an additional path, not a replacement for it.
- `/pending`'s natural-language form (`formatPendingActions`, invoked when the
  command regex matches `pending|approvals|pending approvals` at
  `gateway-runner.ts:251-253`) — stays reachable by typing "pending", just
  loses its `/pending` slash-command registration.
- Any change to how a connector write actually gets gated
  (`pending-actions.ts`'s `createPendingAction`/`approvePendingAction`/
  `denyPendingAction`) — this spec only changes how the user tells the bot
  their decision, not the gating logic itself.
- Multi-account or non-Telegram platforms. `platformConnections` already
  supports other platforms in principle, but the mini-app auth flow this spec
  adds is Telegram-specific (`initData`), and nothing here touches other
  adapters.

## Architecture

### A. Kill the command popup, register the mini-app menu button

`TelegramAdapter.connect()` (`apps/backend/src/gateway/platforms/telegram.ts:57-105`)
currently only verifies the token and (conditionally) re-registers the
webhook. It gains two more calls, made unconditionally on every boot — both
are cheap, idempotent Telegram Bot API calls, so re-running them on every
Workers isolate boot is not a concern (same reasoning the file already applies
to `getWebhookInfo`):

```ts
await fetch(`${this.apiUrl}/deleteMyCommands`, { method: "POST" })
await fetch(`${this.apiUrl}/setChatMenuButton`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    menu_button: {
      type: "web_app",
      text: "Dashboard",
      web_app: { url: `${webAppBaseUrl}/telegram-app` },
    },
  }),
})
```

`webAppBaseUrl` is the landing origin (`getyomi.in`), derived the same way
`auth.ts`'s `webOrigin` already is (`process.env["CORS_ORIGIN"] ?? "https://getyomi.in"`)
— not a new source of truth, just read from the same env var in the adapter.

`deleteMyCommands` clears whatever command list is currently registered,
regardless of whether it was set via BotFather or a previous code path —
Telegram has no per-source command lists, the last write wins. This makes the
popup's absence self-healing on every deploy rather than a one-time manual
BotFather edit.

`setWebhook`'s `allowed_updates` (`telegram.ts:89-93`) grows from
`["message"]` to `["message", "callback_query"]` — Telegram only delivers
`callback_query` updates (inline button taps) to webhooks that opt in.

### B. Inline buttons replace /stop, /new, /approve, /deny

Today each turn is a single outbound `sendMessage` call, and control commands
are literal string matches: `/stop`/`/new`/`/start`/`/help` in
`handleControlCommand` (`gateway-runner.ts:1647-1706`), and the explicit
`/approve`/`/deny`/`/approve <id>`/`/deny <id>` branches in
`handleApprovalCommand` (`gateway-runner.ts:226-369`, specifically the
`isExplicitApprovalCommand` check at line 232 and the `<id>`-suffixed regex at
line 322).

New per-turn message lifecycle, built on two additions to `PlatformAdapter`
(`platform-adapter.ts:3-25`) and `TelegramAdapter`:

```ts
editMessageText(
  chatId: string,
  messageId: string,
  text: string,
  options?: { buttons?: InlineButton[][] },
): Promise<{ ok: boolean; error?: string }>

answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>
```

where `InlineButton = { text: string; callbackData: string }`, mapped to
Telegram's `reply_markup.inline_keyboard` / `callback_data` shape inside the
adapter (matching how `sendMessage` already maps `text`/`parse_mode` today).

Turn flow:

1. A user message arrives. Before the agent runs, the bot sends "Working on
   it…" with one button: `[⏹ Stop]` (`callback_data: "stop"`). The returned
   `messageId` is stored alongside the run's `AbortController` — `activeRuns`
   (`gateway-runner.ts:81`, keyed by `runKey(platform, chatId)`) changes from
   `Map<string, AbortController>` to `Map<string, { controller:
   AbortController; messageId: string }>` — so the callback handler can look
   up both the controller to abort and the message to edit from the same key.
2. When the run finishes, the placeholder message is edited in place: text
   becomes the real reply, buttons become `[🔄 New chat]`
   (`callback_data: "new"`).
3. If the run's result carries a newly-created pending action (see below),
   the message is edited to the action's preview text with
   `[✅ Approve] [❌ Deny]` (`callback_data: "approve:<id>"` /
   `"deny:<id>"`) instead of the New-chat button.
4. A button tap delivers a `callback_query` webhook update. A new branch in
   the webhook handler (`gateway/routes.ts:179-`) parses `callback_data` and
   routes to the same underlying functions the text commands call today
   (`approvePendingAction`/`denyPendingAction` from `pending-actions.ts`, the
   abort-controller logic currently inline in `handleControlCommand`'s
   `/stop` branch, and the session-reset logic in its `/new` branch) — no new
   business logic, only a new entry point into it. `answerCallbackQuery` is
   called first (Telegram requires this within a short window or the client
   shows a stuck spinner), then the message is edited to reflect the outcome
   (e.g. "Denied." with no buttons, or the resumed agent reply once
   `resumeAfterApproval` completes).

`RunAgentResult` (`agent/run.ts:83-86`) gains an optional field:

```ts
export interface RunAgentResult {
  text: string
  quotaError?: boolean
  newPendingActionId?: string
}
```

populated wherever `run.ts` observes `createPendingAction` return a new row
during that turn (it already imports and calls into `pending-actions.ts`
directly, so this is a threading change, not a new dependency). This is what
lets `gateway-runner.ts` decide, after a run completes, whether to attach
Approve/Deny buttons instead of the default New-chat button — without
re-parsing the reply text to guess.

The literal `/stop`, `/new`, `/start`, `/help` branches in
`handleControlCommand`, and the `/approve`/`/deny`/`<id>`-suffixed branches in
`handleApprovalCommand`, are deleted. The natural-language paths in both
functions (yes/no matching, bare "pending") are untouched per the Non-goals
section.

### C. Mini-app dashboard

New route `apps/landing/src/app/telegram-app/page.tsx`. On mount it loads
Telegram's `telegram-web-app.js` SDK, reads `window.Telegram.WebApp.initData`,
and `POST`s it to a new backend endpoint, `POST /api/telegram/webapp-auth`
(`apps/backend/src/routes/gateway.ts` or a new `routes/telegram-webapp.ts` —
exact file TBD at implementation time, follows the existing `routes/`
convention).

That endpoint:

1. Verifies `initData`'s signature per Telegram's documented check (HMAC-SHA256
   over the data-check-string, keyed by `HMAC-SHA256("WebAppData", botToken)`)
   — this proves the payload came from Telegram's client, not a spoofed
   `fetch` from an arbitrary page claiming to be the webview.
2. Extracts the Telegram user id from the verified payload and looks it up in
   `platformConnections` (`packages/db/src/schema.ts:553-574`, `platform =
   "telegram"`, `platformUserId = <id>`) to find the linked `userId`.
3. If linked: mints a Better Auth session — a row in the `session` table
   (`auth-schema.ts:46-57`: `id`, `token`, `userId`, `expiresAt`,
   `createdAt`, `updatedAt`) — and returns it as a `Set-Cookie`. Cross-subdomain
   cookies are already configured for `.getyomi.in` in `auth.ts:37-38`
   (`crossSubDomainCookies`), so a cookie set by `api.getyomi.in` in response
   to this call is readable by the `getyomi.in` page that made the request.
   Whether this is a direct Drizzle insert against the `session` table or a
   call through a Better Auth server API is an implementation detail to
   confirm against Better Auth's actual surface — flagged in Open Questions.
4. If not linked: returns `{ linked: false }`; the page falls back to the
   existing `/link` flow instead of a dead end.

Once the cookie is set, the page redirects to the existing `/dashboard`.
Reused as-is per the Non-goals section — no new dashboard UI, only a possible
follow-up CSS pass for phone-webview width, which is a normal responsive fix
and not part of this spec's scope.

## Data flow (per-turn, happy path)

```
user text ──▶ webhook (message) ──▶ send "Working on it…" [⏹ Stop] ──▶ runAgent()
                                                                              │
                                        ┌─────────────────────────────────────┘
                                        ▼
                        result.newPendingActionId set?
                        ├─ yes ──▶ edit message: preview text, [✅ Approve][❌ Deny]
                        └─ no  ──▶ edit message: reply text,   [🔄 New chat]

button tap ──▶ webhook (callback_query) ──▶ answerCallbackQuery()
                                                    │
                                    route by callback_data prefix
                                    ├─ "stop"          → abort controller (existing /stop logic)
                                    ├─ "new"            → reset session (existing /new logic)
                                    ├─ "approve:<id>"   → approvePendingAction (existing logic)
                                    └─ "deny:<id>"      → denyPendingAction (existing logic)
                                                    │
                                                    ▼
                                          edit message to reflect outcome
```

## Error handling

- `editMessageText` failure (e.g. message too old for Telegram to edit,
  network error): caught and logged, matching every other adapter call's
  `.catch(() => {})`/best-effort convention already used throughout
  `gateway-runner.ts`. A failed edit does not retry — the user can still see
  the original placeholder and can send a new message.
- `callback_query` for a button whose action already resolved (e.g. a second
  tap on Approve after the first tap already executed it, or a tap after the
  underlying pending action expired): routes through the same
  `approvePendingAction`/`denyPendingAction` calls, which already return
  `null`/a non-`"executed"` status for a missing-or-expired action
  (`pending-actions.ts`, matching `gateway-runner.ts:283-288`'s existing
  handling) — the callback handler surfaces that as an edited message
  ("I couldn't find that pending action…"), not a crash.
- `webapp-auth` with an unverifiable `initData` signature: `401`, no session
  minted, no `platformConnections` lookup performed — same trust posture as
  a forged Authorization header.
- `webapp-auth` with a verified but unlinked Telegram id: `{ linked: false
}`, `200` — this is an expected, common case (opening the mini-app before
  ever linking Telegram to a Yomi account), not an error.

## Testing

- `apps/backend/src/gateway/platforms/telegram.test.ts`: `connect()` calls
  `deleteMyCommands` and `setChatMenuButton` with the expected `web_app` URL;
  `setWebhook`'s `allowed_updates` includes `callback_query`;
  `editMessageText`/`answerCallbackQuery` map their arguments to the correct
  Telegram API shape and surface `ok`/`error` the same way `sendMessage` does
  today.
- `apps/backend/src/gateway/gateway-runner.test.ts`: a run that produces
  `newPendingActionId` results in an edit with Approve/Deny buttons instead of
  New-chat; a normal run's completion edits in the New-chat button; a `/stop`-
  equivalent `callback_query` aborts the tracked controller for that chat and
  only that chat (isolation, mirroring the existing per-conversation isolation
  tests for `pendingDocuments`); an approve/deny `callback_query` for an
  already-resolved action edits in the "couldn't find that pending action"
  message rather than throwing; the deleted `/stop`/`/new`/`/approve`/`/deny`
  text branches no longer match (natural-language yes/no still does).
- `apps/backend/src/gateway/routes.test.ts`: a `callback_query` update is
  parsed and routed distinctly from a `message` update; malformed
  `callback_data` (unrecognized prefix) is a no-op, not a crash.
- New `apps/backend/src/routes/telegram-webapp.test.ts` (or wherever the
  endpoint lands): valid signed `initData` for a linked Telegram id mints a
  session and returns a `Set-Cookie`; valid signed `initData` for an unlinked
  id returns `{ linked: false }` with no session; a tampered/invalid signature
  is rejected with `401` and no DB lookup happens at all (verify-before-lookup
  ordering, so a forged payload can't probe `platformConnections`).
- `apps/landing/src/app/telegram-app/page.tsx`: manual verification only
  (Telegram's `initData` requires a real Telegram client context to generate
  meaningfully) — opening the mini-app button in an actual Telegram client
  against a linked account lands on `/dashboard` signed in; against an
  unlinked account falls back to `/link`.

## Open questions / deliberately deferred

- **Session-minting mechanism.** Whether `webapp-auth` inserts directly into
  the `session` table (matching the schema Better Auth already owns) or goes
  through a Better Auth server-side API needs to be confirmed against Better
  Auth's actual exposed surface during implementation — this spec commits to
  the outcome (a valid, cookie-readable session for the linked user) but not
  the exact call.
- **Placeholder message copy and Stop-button visibility for fast replies.**
  Cheap-path replies (`fastTelegramRespond`, `gateway-runner.ts:449-493`)
  often resolve in well under a second — sending and then immediately editing
  a "Working on it…" placeholder for those may read as flicker. Whether the
  placeholder is skipped for the fast path (going straight to a final message
  with just a New-chat button, no edit) or always sent is left to
  implementation judgment, informed by how it actually looks in a live chat.
- **`/telegram-app` responsive pass.** The existing `/dashboard` is reused
  as-is per Non-goals; if it renders poorly at Telegram's in-app browser
  width, that's a small follow-up, not blocking for this spec.
