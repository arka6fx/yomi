# Desktop Google auto-connect — design

**Date:** 2026-07-07
**Status:** Approved

## Problem

After signing in with Google during desktop device-code auth, the user lands on
`/device?code=XXX&provider=google` with the code pre-filled but must still press
**Connect**. Every other provider auto-confirms; only Google is skipped
(`apps/landing/src/app/device/page.tsx` auto-confirm effect:
`if (provider === "google") return`). The skip predates the `fresh=1` flow,
which now forces the user through Google's account picker moments earlier — so
the Connect press is pure friction with no remaining purpose.

## Change

One file: `apps/landing/src/app/device/page.tsx`.

In the auto-confirm effect, replace the Google skip with a freshness guard:

```tsx
// before
if (provider === "google") return
// after
if (fresh || switchingAccount) return
```

and add `fresh` and `switchingAccount` to the effect's dependency array.

## Why a guard instead of deleting the skip outright

On first arrival the desktop opens the browser with `fresh=1`. The page signs
out any stale web session and redirects to sign-in so the user picks the right
Google account. If auto-confirm ran unguarded it could race that sign-out and
connect the *stale* account — the exact bug `fresh=1` exists to prevent. The
post-sign-in redirect back to `/device` carries no `fresh` param, so
auto-confirm fires only after the user has just picked their account.
`switchingAccount` is also guarded to cover the render between starting the
sign-out and the redirect.

Note `fresh` and `urlCode` are set together in the same URL-param effect, so
there is no render where `urlCode` is set but `fresh` is stale.

## Resulting flow

Desktop opens browser → Google account picker → land on `/device` →
"Connecting your desktop app…" spinner → "You're connected". Zero clicks. The
desktop app is already polling `/device-code/token` and logs in within its poll
interval. Identical to the GitHub path today.

## Error handling

Unchanged. If confirm fails (expired/invalid code), `loading` clears and the
existing manual form renders with the friendly error — the Connect button
remains as fallback.

## Scope

No backend, desktop, or schema changes.

## Verification

- Run landing + backend locally, trigger desktop Google sign-in, confirm
  zero-click connect.
- Confirm the `fresh=1` flow still forces the Google account picker and never
  connects a stale session.
- Non-Google provider auto-confirm unchanged.
