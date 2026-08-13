# Telegram Mini App → dashboard handoff — design

Status: approved Date: 2026-08-12

## Problem

The Telegram Mini App's "already linked" path
(`apps/landing/src/app/telegram-app/page.tsx`,
`apps/backend/src/auth/telegram-webapp-plugin.ts`, shipped in the 2026-08-09
telegram-inline-controls-and-mini-app-dashboard work) does: verify the Mini
App's `initData` → mint a Better Auth session cookie inside Telegram's own
embedded webview → `router.replace("/dashboard")` inside that same webview.

Two independent things break this in production:

1. Google (and other OAuth providers) refuse to complete sign-in when the
   requesting page is loaded inside an embedded webview. Telegram's Mini App
   surface — specifically Telegram Web/Desktop, which unlike mobile clients does
   not auto-promote same-frame navigations to an external browser — is exactly
   that kind of embedded webview. Any Google-OAuth-triggering button rendered
   inside the Mini App (sign-in, connector linking, credit checkout) hit
   Google's generic "403 — you do not have access" page. Fixed separately
   (commit `2bc810a`, `apps/landing/src/lib/telegram-webapp.ts`'s
   `openExternal()`, used by `AuthCard.tsx` and `dashboard/page.tsx`) — that fix
   is a prerequisite for this spec but not part of it.
2. **This spec's problem:** even without any OAuth click, a cookie set inside
   Telegram's internal webview never reaches a real external browser. They are
   separate processes with separate cookie jars — confirmed by comparison with
   Folk (a comparable Telegram-based assistant), whose Mini App shows a static
   "opened your dashboard in the browser, Telegram desktop can't keep you logged
   in inside this window" screen rather than attempting to render an
   authenticated dashboard inside its own webview at all. So the existing
   "linked → set cookie → same-frame redirect to /dashboard" flow cannot work as
   designed, independent of the OAuth issue.

## Goal

Tapping the Mini App's Dashboard menu button, for an account already linked to
Telegram, opens `/dashboard` **authenticated**, in a real external browser — not
inside Telegram's own webview.

## Non-goals

- The "not yet linked" path (Mini App shows a "link your account" fallback →
  `/link` → `/signin` → Google/GitHub OAuth) is unchanged by this spec. Linking
  is a one-time, server-side action, not a session that has to survive inside
  the iframe — and its OAuth-inside-webview problem is already fixed by the
  separate `openExternal()` change referenced above.
- No change to the dashboard UI itself, or to how a normally-authenticated
  (non-Telegram) session works.
- No change to `verifyTelegramInitData`'s signature-verification logic —
  unchanged from the existing, already-reviewed implementation.

## Architecture

### A. `telegram-webapp-auth` stops setting a cookie for the linked case

`apps/backend/src/auth/telegram-webapp-plugin.ts`'s existing
`POST /api/auth/telegram-webapp-auth` endpoint keeps its unlinked branch
(`{ ok: true, linked: false }`, no session, no token — the Mini App shows the
existing "link your account" fallback) exactly as today.

Its linked branch changes: instead of
`ctx.context.internalAdapter.createSession` + `setSessionCookie` (setting a
cookie inside the calling iframe's own context, which this spec has established
is useless), it mints a single-use login token and returns a redeem URL:

```ts
const token = generateLoginToken() // random, unguessable — same rigor as a session id
await db.insert(telegramMiniappLoginTokens).values({
  token,
  userId,
  expiresAt: new Date(Date.now() + 2 * 60 * 1000), // 2 minutes
})
return ctx.json({
  ok: true,
  linked: true,
  redeemUrl: `${webAppBaseUrl}/api/auth/telegram-webapp-redeem?token=${token}`,
})
```

`webAppBaseUrl` follows the same `CORS_ORIGIN`-derived pattern the Task 1
menu-button registration already uses — not a new source of truth.

### B. New DB table: `telegram_miniapp_login_tokens`

New migration, following this repo's existing pattern for short-lived auxiliary
state (mirrors how `pendingConnectorNudge` was added):

```ts
export const telegramMiniappLoginTokens = pgTable(
  "telegram_miniapp_login_tokens",
  {
    token: text("token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
  },
)
```

No index beyond the primary key is needed — lookups are always by exact token,
and rows are few and short-lived (a cron sweep to delete long-expired,
already-used rows is a reasonable future addition, out of scope here — the table
stays small regardless, since Mini App opens are infrequent per user).

### C. New endpoint: `GET /api/auth/telegram-webapp-redeem`

Added as a second endpoint on the existing `telegramWebAppAuth()` Better Auth
plugin (`telegram-webapp-plugin.ts`), alongside the existing one — same file,
same plugin object, consistent with how the plugin already groups
Telegram-Mini-App-specific auth surface together.

Unauthenticated by design — the token itself is the credential, the same trust
model as a password-reset or magic-link URL:

1. Atomically claim the token in one statement —
   `UPDATE telegram_miniapp_login_tokens SET used_at = now() WHERE token = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`
   — so there is no separate read-then-write window a raced double-tap (e.g.
   `openLink` somehow firing the redeem request twice) could exploit to redeem
   the same token twice.
2. Zero rows returned (token missing, already used, or expired — all three
   collapse to the same outcome) → redirect to
   `${webOrigin}/link?error=expired_link`. `expired_link` covers all three cases
   from the user's perspective — no need to distinguish them in the UI.
3. One row returned → mint a real session via the same
   `internalAdapter.createSession`/`findUserById`/`setSessionCookie` calls the
   original endpoint used to make directly, and issue an HTTP redirect (302) to
   `${webOrigin}/dashboard`.

Because this request runs inside the external browser that Telegram just opened
via `openLink`, the `Set-Cookie` this endpoint issues lands in that browser's
own cookie jar — the one that will actually render `/dashboard` on the following
redirect.

### D. Mini App page: open externally instead of same-frame redirect

`apps/landing/src/app/telegram-app/page.tsx`'s linked branch changes from:

```ts
if (data.ok && data.linked) {
  router.replace("/dashboard")
}
```

to:

```ts
if (data.ok && data.linked && data.redeemUrl) {
  openExternal(data.redeemUrl) // from src/lib/telegram-webapp.ts, already shipped
  setStatus("opened")
}
```

A new `"opened"` status renders a static confirmation screen (Folk's pattern,
Yomi-voiced): "Opened your dashboard in the browser — tap back to chat." If
`window.Telegram?.WebApp?.openLink` isn't available (an old Telegram client —
`openExternal()` already falls back to `window.location.href` in that case,
which would go right back to the same-webview problem this spec exists to fix),
the `"opened"` screen also renders the `redeemUrl` as a plain tappable link, so
the user has a manual escape hatch even when the SDK method is missing.

## Data flow (happy path)

```
[Telegram iframe: /telegram-app]
  → POST /api/auth/telegram-webapp-auth (initData)
  → backend verifies initData, resolves linked userId
  ← { ok: true, linked: true, redeemUrl }
  → Telegram.WebApp.openLink(redeemUrl)   — escapes to a real external browser
  → mini-app renders the "opened" screen, done — no polling, no further
    interaction with the iframe's own state

[External browser — separate process, separate cookie jar]
  → GET /api/auth/telegram-webapp-redeem?token=...
  → backend: token valid & unused → mark used, createSession, setSessionCookie
  → 302 → https://getyomi.in/dashboard   (now authenticated, in this browser)
```

## Error handling

- Missing, expired, or already-used token at redeem time: redirect to
  `/link?error=expired_link` — an expected, recoverable case (the user just
  reopens the Mini App and taps Dashboard again), not a dead-end or a raw error
  page.
- `openLink` unavailable client-side: manual link fallback, per Architecture
  section D above.
- A leaked/screenshotted redeem URL: bounded by 2-minute expiry and single-use
  marking — the same exposure window a typical magic-link accepts.
- `telegram-webapp-auth`'s existing verify-before-lookup ordering (HMAC check
  before any DB query) is unchanged — this spec only changes what happens after
  a successful, already-verified lookup.

## Testing

- `telegram-webapp-plugin.test.ts` (existing file, extended): the linked-branch
  of `telegram-webapp-auth` now asserts a `redeemUrl` in the response and a new
  row in `telegramMiniappLoginTokens`, not a `Set-Cookie` header.
- New tests for `telegram-webapp-redeem`'s three branches: valid
  unused-and-unexpired token (mints a session, 302s to `/dashboard`), expired
  token, already-used token (both redirect to `/link?error=expired_link`) —
  DB-mocked, matching this file's existing `mock.module("@yomi/db", ...)`
  pattern.
- `openExternal()` and its fallback are already covered by
  `telegram-webapp.test.ts` (shipped in the OAuth-block fix) — no new coverage
  needed there.
- The `"opened"` status screen in `telegram-app/page.tsx` is UI-only, verified
  manually like the rest of this page already is (Telegram's `initData`/`WebApp`
  API only populates meaningfully inside a real Telegram client).
- Manual verification (unavoidable): confirm on Telegram Web/Desktop _and_ at
  least one mobile client that tapping the Dashboard menu button lands in a
  genuinely separate, authenticated browser tab/window — this is the one thing
  no automated test can confirm, and it's the entire point of this spec.

## Open questions / deliberately deferred

- **Cron cleanup of expired/used token rows.** The table stays small on its own
  (infrequent Mini App opens per user, 2-minute-lived rows), so a sweep is a
  reasonable future addition rather than something this spec needs to ship.
