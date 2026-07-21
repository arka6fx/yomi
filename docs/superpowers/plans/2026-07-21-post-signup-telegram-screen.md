# Post-Signup Telegram Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-built `/link` page the actual post-signup destination, with its Telegram deep link ready immediately (no click required) and a QR code for cross-device scanning.

**Architecture:** All changes are in `apps/landing` — one dependency add, changes to two existing pages, no new files, no backend changes (the `/api/gateway/telegram/token` endpoint this depends on already exists and is unchanged).

**Tech Stack:** Next.js (client component), `qrcode.react` (new dependency).

## Global Constraints

- Full design rationale lives in
  `docs/superpowers/specs/2026-07-21-post-signup-telegram-screen-design.md`
  — read it if anything here seems underspecified.
- QR code generation must be client-side (`qrcode.react`'s `QRCodeSVG`) —
  never a third-party QR-image API, since the deep link carries a
  one-time auth token that a third party could intercept and race the
  user to consume.
- No automated tests — `apps/landing` has no test harness for
  client-rendered pages (confirmed across two prior features this
  session). Verify with typecheck + lint; manual verification needs a
  real backend/DB session this sandbox doesn't have.
- Accepted limitation, not a bug to fix: the deep-link token expires in
  15 minutes with no refresh-on-expiry handling in v1.

---

### Task 1: Pre-fetch the deep link on mount, simplify `handleConnect`

**Files:**
- Modify: `apps/landing/src/app/link/page.tsx`

**Interfaces:**
- Consumes: nothing new — `POST /api/gateway/telegram/token` (existing
  endpoint, unchanged), existing `session`, `deepLink`/`setDeepLink`,
  `connected`, `waitingForTelegram`/`setWaitingForTelegram` state.
- Produces: a new `fetchDeepLink(): Promise<string | null>` helper —
  consumed by Task 2 only insofar as Task 2 doesn't call it directly (it
  just renders `deepLink` once this task populates it sooner). No other
  file depends on this task's internals.

No automated test — see Global Constraints. Verify with typecheck + lint.

- [ ] **Step 1: Extract the token-fetch into its own function**

In `apps/landing/src/app/link/page.tsx`, find `handleConnect`:

```tsx
  async function handleConnect() {
    setConnecting(true)
    setError("")
    setDeepLink("")
    const telegramWindow = window.open("about:blank", "_blank")
    if (telegramWindow) telegramWindow.opener = null
    try {
      const res = await fetch(`/api/gateway/telegram/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session!.session.token}`,
        },
      })
      const data = (await res.json()) as { deepLink?: string; error?: string }
      if (!res.ok || !data.deepLink) throw new Error(data.error ?? "Failed to connect")
      setDeepLink(data.deepLink)
      setWaitingForTelegram(true)
      if (telegramWindow) {
        telegramWindow.location.href = data.deepLink
      } else {
        window.location.href = data.deepLink
      }
      void waitForTelegramLink()
    } catch (err) {
      telegramWindow?.close()
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
      setWaitingForTelegram(false)
    } finally {
      setConnecting(false)
    }
  }
```

Replace it with a standalone fetch helper plus two `handleConnect`
branches — a fast path when `deepLink` is already populated (pre-fetched
by Task 1's mount effect, added below), and the original fallback path
for when it isn't yet:

```tsx
  async function fetchDeepLink(): Promise<string> {
    const res = await fetch(`/api/gateway/telegram/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session!.session.token}`,
      },
    })
    const data = (await res.json()) as { deepLink?: string; error?: string }
    if (!res.ok || !data.deepLink) throw new Error(data.error ?? "Failed to connect")
    return data.deepLink
  }

  async function handleConnect() {
    setConnecting(true)
    setError("")

    // Fast path: the mount-time effect already has a live token. A plain
    // window.open with a real URL, called synchronously inside this click
    // handler, is popup-blocker-safe — no about:blank trick needed.
    if (deepLink) {
      window.open(deepLink, "_blank")
      setWaitingForTelegram(true)
      setConnecting(false)
      void waitForTelegramLink()
      return
    }

    // Fallback: mount-time fetch hasn't resolved yet (or failed). Keep the
    // about:blank-then-redirect trick here, since this path awaits a fetch
    // before it has anywhere to send the popup.
    const telegramWindow = window.open("about:blank", "_blank")
    if (telegramWindow) telegramWindow.opener = null
    try {
      const link = await fetchDeepLink()
      setDeepLink(link)
      setWaitingForTelegram(true)
      if (telegramWindow) {
        telegramWindow.location.href = link
      } else {
        window.location.href = link
      }
      void waitForTelegramLink()
    } catch (err) {
      telegramWindow?.close()
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
      setWaitingForTelegram(false)
    } finally {
      setConnecting(false)
    }
  }
```

- [ ] **Step 2: Add the mount-time pre-fetch effect**

Find the existing `checkTelegramLinked` effect:

```tsx
  useEffect(() => {
    if (!session) return
    void checkTelegramLinked()
      .then(setConnected)
      .catch(() => {})
  }, [session])
```

Add a new effect immediately after it:

```tsx
  useEffect(() => {
    if (!session || connected) return
    void fetchDeepLink()
      .then(setDeepLink)
      .catch(() => {
        // best-effort — handleConnect's fallback path re-fetches on click
      })
  }, [session, connected])
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd apps/landing && bun run typecheck && bun run lint`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/landing/src/app/link/page.tsx
git commit -m "feat(landing): pre-fetch the Telegram deep link on page load"
```

---

### Task 2: QR code

**Files:**
- Modify: `apps/landing/package.json` (new dependency)
- Modify: `apps/landing/src/app/link/page.tsx`

**Interfaces:**
- Consumes: `deepLink` state (populated by Task 1).
- Produces: nothing consumed elsewhere.

No automated test — see Global Constraints. Verify with typecheck + lint.

- [ ] **Step 1: Add the dependency**

Run: `cd apps/landing && bun add qrcode.react`
Expected: `apps/landing/package.json`'s `dependencies` gains a
`"qrcode.react"` entry, `bun.lock` updates.

- [ ] **Step 2: Import it**

In `apps/landing/src/app/link/page.tsx`, find:

```tsx
import { authClient } from "@/lib/auth-client"
```

Change to:

```tsx
import { authClient } from "@/lib/auth-client"
import { QRCodeSVG } from "qrcode.react"
```

- [ ] **Step 3: Render it in the initial (not-yet-connected) state**

Find the closing helper paragraph of the initial state's JSX block (the
third branch of the `connected ? ... : waitingForTelegram ? ... : ...`
chain):

```tsx
              <p className="text-xs text-muted-foreground leading-relaxed">
                Use this button instead of searching for the bot manually. It includes a private
                one-time link token.
              </p>
            </>
          )}
```

Change to:

```tsx
              <p className="text-xs text-muted-foreground leading-relaxed">
                Use this button instead of searching for the bot manually. It includes a private
                one-time link token.
              </p>

              {deepLink && (
                <div className="flex flex-col items-center gap-2 pt-2">
                  {/* White background regardless of app theme — QR scanners need light
                      modules on a light background to read reliably, not a stylistic choice. */}
                  <div className="rounded-xl border border-border bg-white p-3">
                    <QRCodeSVG value={deepLink} size={120} />
                  </div>
                  <p className="text-xs text-muted-foreground">Or scan with your phone</p>
                </div>
              )}
            </>
          )}
```

- [ ] **Step 4: Typecheck and lint**

Run: `cd apps/landing && bun run typecheck && bun run lint`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/landing/package.json apps/landing/bun.lock apps/landing/src/app/link/page.tsx
git commit -m "feat(landing): add a QR code to the Telegram connect screen"
```

---

### Task 3: Make `/link` the signup destination

**Files:**
- Modify: `apps/landing/src/app/signup/page.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed elsewhere — end of the chain.

No automated test — see Global Constraints. Verify with typecheck + lint.

- [ ] **Step 1: Change the callback URL**

Find:

```tsx
export default function SignUpPage() {
  return (
    <AuthLayout mode="signup">
      <AuthCard defaultMode="signup" callbackURL="/dashboard?welcome=1" />
    </AuthLayout>
  )
}
```

Change to:

```tsx
export default function SignUpPage() {
  return (
    <AuthLayout mode="signup">
      <AuthCard defaultMode="signup" callbackURL="/link" />
    </AuthLayout>
  )
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `cd apps/landing && bun run typecheck && bun run lint`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/landing/src/app/signup/page.tsx
git commit -m "feat(landing): send new signups to the Telegram connect screen"
```

---

### Task 4: Whole-monorepo verification and manual check

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: no new errors (pre-existing warnings in unrelated files are
fine, per this session's established baseline)

- [ ] **Step 2: Full test suite**

Run: `bun run test`
Expected: PASS, no regressions (this feature adds no automated tests of
its own, per Global Constraints)

- [ ] **Step 3: Attempt a manual walkthrough**

Use this project's `run` skill to start the dev server and walk through
signup → `/link`. If this environment can reach a real backend/DB and you
can sign up: confirm the QR code and "Connect Telegram" button both
appear immediately (no click needed first), confirm the QR code encodes
a working `t.me` deep link, confirm clicking "Connect Telegram" opens a
new tab directly (no intermediate blank tab) since the link is
pre-fetched.

If sign-in/sign-up isn't reachable (as it wasn't in this sandbox for the
two prior features this session): report that clearly rather than
guessing, and tell the user this specific check needs to happen on a
machine with a real session.

- [ ] **Step 4: Final commit check**

Run: `git status --short`
Expected: clean (everything from Tasks 1–3 already committed per-task)
